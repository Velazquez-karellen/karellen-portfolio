/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { boundedInteger, canonicalLocale, optionalHttpUrl, resolveLocale, slugify } from "./backend-utils";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  ADMIN_EMAIL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSLATION_MODEL?: string;
  IMAGES: {
    info(stream: ReadableStream): Promise<{
      format: string;
      fileSize: number;
      width: number;
      height: number;
    }>;
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const json = (data: unknown, status = 200) => Response.json(data, { status });

function handleHealth(env: Env) {
  return json({
    service: "kare-platform",
    status: "ok",
    database: Boolean(env.DB),
    objectStorage: Boolean(env.BUCKET),
  });
}

function isEditor(request: Request, env: Env) {
  const email = request.headers.get("oai-authenticated-user-email")?.toLowerCase();
  if (!email) return false;
  const hostname = new URL(request.url).hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  return local || Boolean(env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase());
}

type TranslationInput = {
  locale: string;
  title: string;
  summary: string;
  body: string;
  translationStatus: "original" | "machine" | "reviewed";
};

type ContentMediaInput = {
  mediaId: string;
  role: "cover" | "gallery" | "inline";
  sortOrder: number;
};

function contentValues(payload: Record<string, unknown>) {
  const value = (key: string) => typeof payload[key] === "string" ? String(payload[key]).trim() : "";
  const sourceLocale = canonicalLocale(payload.sourceLocale);
  const rawTranslations = Array.isArray(payload.translations) ? payload.translations : [];
  const translations = rawTranslations.flatMap((entry): TranslationInput[] => {
    if (!entry || typeof entry !== "object") return [];
    const translation = entry as Record<string, unknown>;
    const locale = canonicalLocale(translation.locale);
    const title = typeof translation.title === "string" ? translation.title.trim() : "";
    const body = typeof translation.body === "string" ? translation.body.trim() : "";
    if (!locale || (!title && !body)) return [];
    const requestedStatus = translation.translationStatus;
    const translationStatus = locale === sourceLocale
      ? "original"
      : requestedStatus === "reviewed" ? "reviewed" : "machine";
    return [{
      locale,
      title,
      summary: typeof translation.summary === "string" ? translation.summary.trim() : "",
      body,
      translationStatus,
    }];
  });
  const rawMedia = Array.isArray(payload.media) ? payload.media : [];
  const media = rawMedia.flatMap((entry): ContentMediaInput[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const mediaId = typeof item.mediaId === "string" ? item.mediaId.trim() : "";
    if (!mediaId) return [];
    const role = item.role === "cover" || item.role === "inline" ? item.role : "gallery";
    const sortOrder = typeof item.sortOrder === "number" && Number.isInteger(item.sortOrder) ? item.sortOrder : 0;
    return [{ mediaId, role, sortOrder }];
  });

  return {
    type: value("type") || "post",
    status: value("status") === "published" ? "published" : "draft",
    sourceLocale,
    coverImageKey: value("coverImageKey") || null,
    sortOrder: typeof payload.sortOrder === "number" && Number.isInteger(payload.sortOrder) ? payload.sortOrder : 0,
    featured: payload.featured === true,
    scheduledAt: value("scheduledAt") || null,
    translations,
    media,
    replaceMedia: Array.isArray(payload.media),
  };
}

async function audit(request: Request, env: Env, action: string, entityType: string, entityId?: string, details: unknown = {}) {
  const actor = request.headers.get("oai-authenticated-user-email")?.toLowerCase() ?? "unknown";
  await env.DB.prepare(
    "INSERT INTO admin_audit_log (id,action,entity_type,entity_id,actor_email,details) VALUES (?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), action, entityType, entityId ?? null, actor, JSON.stringify(details)).run();
}

async function handleLocales(request: Request, env: Env) {
  if (request.method !== "GET" && !isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  if (request.method !== "GET") {
    const payload = await request.json() as Record<string, unknown>;
    const code = canonicalLocale(payload.code);
    if (!code) return json({ error: "A valid locale code is required." }, 400);
    if (request.method === "DELETE") {
      const current = await env.DB.prepare("SELECT is_default FROM supported_locales WHERE code = ?").bind(code).first<Record<string, unknown>>();
      if (!current) return json({ error: "Locale not found." }, 404);
      if (Boolean(current.is_default)) return json({ error: "The default locale cannot be deleted." }, 409);
      const references = await env.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM content_items WHERE source_locale = ?) +
          (SELECT COUNT(*) FROM content_translations WHERE locale = ?) +
          (SELECT COUNT(*) FROM media_translations WHERE locale = ?) +
          (SELECT COUNT(*) FROM project_translations WHERE locale = ?) AS count`
      ).bind(code, code, code, code).first<Record<string, unknown>>();
      if (Number(references?.count ?? 0) > 0) return json({ error: "Locale is still referenced by content.", references: Number(references?.count) }, 409);
      await env.DB.prepare("DELETE FROM supported_locales WHERE code = ?").bind(code).run();
      await audit(request, env, "delete", "locale", code);
      return json({ deleted: code });
    }
    if (request.method !== "POST" && request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
    const englishName = typeof payload.englishName === "string" ? payload.englishName.trim().slice(0, 100) : "";
    const nativeName = typeof payload.nativeName === "string" ? payload.nativeName.trim().slice(0, 100) : "";
    if (!englishName || !nativeName) return json({ error: "English and native locale names are required." }, 400);
    const enabled = payload.enabled !== false;
    const isDefault = payload.isDefault === true;
    const autoTranslate = payload.autoTranslate !== false;
    const sortOrder = typeof payload.sortOrder === "number" && Number.isInteger(payload.sortOrder) ? payload.sortOrder : 0;
    if (isDefault && !enabled) return json({ error: "The default locale must be enabled." }, 400);
    if (request.method === "POST") {
      const existing = await env.DB.prepare("SELECT code FROM supported_locales WHERE code = ?").bind(code).first();
      if (existing) return json({ error: "Locale already exists." }, 409);
      await env.DB.batch([
        ...(isDefault ? [env.DB.prepare("UPDATE supported_locales SET is_default = 0")] : []),
        env.DB.prepare("INSERT INTO supported_locales (code,english_name,native_name,enabled,is_default,auto_translate,sort_order) VALUES (?,?,?,?,?,?,?)")
          .bind(code, englishName, nativeName, enabled, isDefault, autoTranslate, sortOrder),
      ]);
      await audit(request, env, "create", "locale", code);
      return json({ locale: { code, englishName, nativeName, enabled, isDefault, autoTranslate, sortOrder } }, 201);
    }
    const current = await env.DB.prepare("SELECT is_default FROM supported_locales WHERE code = ?").bind(code).first<Record<string, unknown>>();
    if (!current) return json({ error: "Locale not found." }, 404);
    if (Boolean(current.is_default) && !enabled) return json({ error: "The default locale cannot be disabled." }, 409);
    await env.DB.batch([
      ...(isDefault ? [env.DB.prepare("UPDATE supported_locales SET is_default = 0")] : []),
      env.DB.prepare("UPDATE supported_locales SET english_name=?,native_name=?,enabled=?,is_default=?,auto_translate=?,sort_order=? WHERE code=?")
        .bind(englishName, nativeName, enabled, isDefault || Boolean(current.is_default), autoTranslate, sortOrder, code),
    ]);
    await audit(request, env, "update", "locale", code);
  }
  const result = await env.DB.prepare(
    "SELECT code, english_name, native_name, enabled, is_default, auto_translate, sort_order FROM supported_locales ORDER BY sort_order, code"
  ).all();
  return json({
    locales: result.results.map((row: Record<string, unknown>) => ({
      code: row.code,
      englishName: row.english_name,
      nativeName: row.native_name,
      enabled: Boolean(row.enabled),
      isDefault: Boolean(row.is_default),
      autoTranslate: Boolean(row.auto_translate),
      sortOrder: row.sort_order,
    })),
  });
}

type TranslatedText = { title: string; summary: string; body: string };

function responseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";
  for (const item of payload.output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as Record<string, unknown>).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === "object" && typeof (content as Record<string, unknown>).text === "string") {
        return String((content as Record<string, unknown>).text);
      }
    }
  }
  return "";
}

async function translateText(env: Env, sourceLocale: string, targetLocale: string, source: TranslatedText) {
  if (!env.OPENAI_API_KEY) throw new Error("Automatic translation is not configured.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini",
      store: false,
      instructions: "You translate portfolio and photo-journal content. Preserve the author's voice, meaning, proper names, URLs, Markdown, code, and paragraph breaks. Do not add facts or commentary. Return only the requested JSON.",
      input: `Translate from ${sourceLocale} to ${targetLocale}. Empty fields must remain empty.\n\n${JSON.stringify(source)}`,
      text: {
        format: {
          type: "json_schema",
          name: "portfolio_translation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              body: { type: "string" },
            },
            required: ["title", "summary", "body"],
          },
        },
      },
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object"
      ? String((payload.error as Record<string, unknown>).message ?? "Translation request failed.")
      : "Translation request failed.";
    throw new Error(error.slice(0, 500));
  }
  const text = responseText(payload);
  const translated = JSON.parse(text) as Partial<TranslatedText>;
  if (typeof translated.title !== "string" || typeof translated.summary !== "string" || typeof translated.body !== "string") {
    throw new Error("Translation response was incomplete.");
  }
  return translated as TranslatedText;
}

async function createAndProcessTranslationJobs(env: Env, contentId: string, requestedLocales?: string[]) {
  const content = await env.DB.prepare(
    `SELECT c.source_locale, t.title, t.summary, t.body, t.updated_at
     FROM content_items c JOIN content_translations t
       ON t.content_id = c.id AND t.locale = c.source_locale
     WHERE c.id = ?`
  ).bind(contentId).first<Record<string, unknown>>();
  if (!content) throw new Error("Original content was not found.");
  const localeResult = await env.DB.prepare(
    "SELECT code FROM supported_locales WHERE enabled = 1 AND auto_translate = 1 AND code <> ? ORDER BY sort_order, code"
  ).bind(content.source_locale).all();
  const allowed = localeResult.results.map((row: Record<string, unknown>) => String(row.code));
  const targets = requestedLocales?.length
    ? Array.from(new Set(requestedLocales.map(canonicalLocale))).filter((locale) => allowed.includes(locale))
    : allowed;
  if (targets.length > 10) throw new Error("Translate at most 10 locales per request.");
  const results: Record<string, unknown>[] = [];
  for (const targetLocale of targets) {
    const existing = await env.DB.prepare(
      "SELECT translation_status FROM content_translations WHERE content_id=? AND locale=?"
    ).bind(contentId, targetLocale).first<Record<string, unknown>>();
    if (existing?.translation_status === "reviewed") {
      results.push({ targetLocale, status: "skipped", reason: "reviewed" });
      continue;
    }
    const jobId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO translation_jobs (id,content_id,target_locale,status) VALUES (?,?,?,'processing')"
    ).bind(jobId, contentId, targetLocale).run();
    await env.DB.prepare(
      "UPDATE translation_jobs SET attempts=attempts+1,started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(jobId).run();
    try {
      const translated = await translateText(env, String(content.source_locale), targetLocale, {
        title: String(content.title ?? ""),
        summary: String(content.summary ?? ""),
        body: String(content.body ?? ""),
      });
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO content_translations
            (content_id,locale,title,summary,body,translation_status,source_locale,source_updated_at,translated_at)
           VALUES (?,?,?,?,?,'machine',?,?,?)
           ON CONFLICT(content_id,locale) DO UPDATE SET
            title=excluded.title,summary=excluded.summary,body=excluded.body,
            translation_status='machine',source_locale=excluded.source_locale,
            source_updated_at=excluded.source_updated_at,translated_at=excluded.translated_at,
            updated_at=CURRENT_TIMESTAMP`
        ).bind(contentId, targetLocale, translated.title, translated.summary, translated.body, content.source_locale, content.updated_at, now),
        env.DB.prepare(
          "UPDATE translation_jobs SET status='completed',error=NULL,completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?"
        ).bind(now, jobId),
      ]);
      results.push({ jobId, targetLocale, status: "completed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Translation failed.";
      await env.DB.prepare(
        "UPDATE translation_jobs SET status='failed',error=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(message.slice(0, 500), jobId).run();
      results.push({ jobId, targetLocale, status: "failed", error: message });
    }
  }
  return results;
}

async function handleTranslations(request: Request, env: Env) {
  if (!isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const contentId = url.searchParams.get("contentId")?.trim();
    const statement = contentId
      ? env.DB.prepare("SELECT * FROM translation_jobs WHERE content_id=? ORDER BY requested_at DESC LIMIT 100").bind(contentId)
      : env.DB.prepare("SELECT * FROM translation_jobs ORDER BY requested_at DESC LIMIT 100");
    const result = await statement.all();
    return json({ jobs: result.results });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const payload = await request.json() as Record<string, unknown>;
  const contentId = typeof payload.contentId === "string" ? payload.contentId.trim() : "";
  if (!contentId) return json({ error: "Missing content id." }, 400);
  const targetLocales = Array.isArray(payload.targetLocales)
    ? payload.targetLocales.filter((locale): locale is string => typeof locale === "string")
    : undefined;
  try {
    const jobs = await createAndProcessTranslationJobs(env, contentId, targetLocales);
    await audit(request, env, "translate", "content", contentId, { targetLocales });
    return json({ jobs });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Translation failed." }, 400);
  }
}

async function handleAudit(request: Request, env: Env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  const limit = boundedInteger(new URL(request.url).searchParams.get("limit"), 50, 1, 200);
  const result = await env.DB.prepare(
    "SELECT id,action,entity_type,entity_id,actor_email,details,created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT ?"
  ).bind(limit).all();
  return json({ events: result.results.map((row: Record<string, unknown>) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorEmail: row.actor_email,
    details: JSON.parse(String(row.details ?? "{}")),
    createdAt: row.created_at,
  })) });
}

async function handleAssets(request: Request, env: Env) {
  if (!isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const [result, translationResult] = await Promise.all([
      env.DB.prepare(
        "SELECT id, storage_key, kind, mime_type, original_filename, byte_size, width, height, created_at FROM media_assets ORDER BY created_at DESC"
      ).all(),
      env.DB.prepare(
        "SELECT media_id, locale, alt_text, caption, updated_at FROM media_translations ORDER BY locale"
      ).all(),
    ]);
    const translationsByMedia = new Map<string, Record<string, unknown>[]>();
    for (const row of translationResult.results as Record<string, unknown>[]) {
      const mediaId = String(row.media_id);
      const translations = translationsByMedia.get(mediaId) ?? [];
      translations.push({
        locale: row.locale,
        altText: row.alt_text,
        caption: row.caption,
        updatedAt: row.updated_at,
      });
      translationsByMedia.set(mediaId, translations);
    }
    return json({
      assets: result.results.map((row: Record<string, unknown>) => ({
        id: row.id,
        storageKey: row.storage_key,
        url: `/media/${row.storage_key}`,
        kind: row.kind,
        mimeType: row.mime_type,
        originalFilename: row.original_filename,
        byteSize: row.byte_size,
        width: row.width,
        height: row.height,
        createdAt: row.created_at,
        translations: translationsByMedia.get(String(row.id)) ?? [],
      })),
    });
  }

  const payload = await request.json() as Record<string, unknown>;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return json({ error: "Missing asset id." }, 400);
  const asset = await env.DB.prepare(
    "SELECT id, storage_key FROM media_assets WHERE id = ?"
  ).bind(id).first<Record<string, unknown>>();
  if (!asset) return json({ error: "Asset not found." }, 404);

  if (request.method === "PUT") {
    if (!Array.isArray(payload.translations)) return json({ error: "Translations are required." }, 400);
    const translations = payload.translations.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const translation = entry as Record<string, unknown>;
      const locale = canonicalLocale(translation.locale);
      if (!locale) return [];
      return [{
        locale,
        altText: typeof translation.altText === "string" ? translation.altText.trim() : "",
        caption: typeof translation.caption === "string" ? translation.caption.trim() : "",
      }];
    });
    if (new Set(translations.map((translation) => translation.locale)).size !== translations.length) {
      return json({ error: "Each locale can appear only once." }, 400);
    }
    const localeRows = await env.DB.prepare("SELECT code FROM supported_locales WHERE enabled = 1").all();
    const supported = new Set(localeRows.results.map((row: Record<string, unknown>) => String(row.code)));
    const unsupported = translations.find((translation) => !supported.has(translation.locale));
    if (unsupported) return json({ error: `Unsupported locale: ${unsupported.locale}` }, 400);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM media_translations WHERE media_id = ?").bind(id),
      ...translations.map((translation) => env.DB.prepare(
        "INSERT INTO media_translations (media_id,locale,alt_text,caption) VALUES (?,?,?,?)"
      ).bind(id, translation.locale, translation.altText, translation.caption)),
    ]);
    await audit(request, env, "update", "asset", id, { translations: translations.map((entry) => entry.locale) });
    return json({ asset: { id, translations } });
  }

  if (request.method === "DELETE") {
    const reference = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM content_media WHERE media_id = ?"
    ).bind(id).first<Record<string, unknown>>();
    const referenceCount = Number(reference?.count ?? 0);
    if (referenceCount > 0) {
      return json({
        error: "Asset is still attached to content.",
        references: referenceCount,
      }, 409);
    }
    await env.BUCKET.delete(String(asset.storage_key));
    await env.DB.prepare("DELETE FROM media_assets WHERE id = ?").bind(id).run();
    await audit(request, env, "delete", "asset", id);
    return json({ deleted: id });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleContent(request: Request, env: Env) {
  const url = new URL(request.url);
  const studio = url.searchParams.get("studio") === "1";
  if ((studio || request.method !== "GET") && !isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const query = studio
      ? "SELECT * FROM content_items ORDER BY updated_at DESC"
      : "SELECT * FROM content_items WHERE status = 'published' AND (scheduled_at IS NULL OR scheduled_at <= CURRENT_TIMESTAMP) ORDER BY featured DESC, COALESCE(published_at, updated_at) DESC";
    const result = await env.DB.prepare(query).all();
    const translationQuery = studio
      ? "SELECT t.* FROM content_translations t JOIN content_items c ON c.id = t.content_id ORDER BY t.locale"
      : "SELECT t.* FROM content_translations t JOIN content_items c ON c.id = t.content_id WHERE c.status = 'published' AND (c.scheduled_at IS NULL OR c.scheduled_at <= CURRENT_TIMESTAMP) ORDER BY t.locale";
    const translationResult = await env.DB.prepare(translationQuery).all();
    const mediaQuery = studio
      ? `SELECT cm.content_id, cm.media_id, cm.role, cm.sort_order,
          m.storage_key, m.kind, m.mime_type, m.original_filename, m.byte_size, m.width, m.height,
          mt.locale, mt.alt_text, mt.caption
         FROM content_media cm
         JOIN media_assets m ON m.id = cm.media_id
         JOIN content_items c ON c.id = cm.content_id
         LEFT JOIN media_translations mt ON mt.media_id = m.id
         ORDER BY cm.content_id, cm.sort_order, mt.locale`
      : `SELECT cm.content_id, cm.media_id, cm.role, cm.sort_order,
          m.storage_key, m.kind, m.mime_type, m.original_filename, m.byte_size, m.width, m.height,
          mt.locale, mt.alt_text, mt.caption
         FROM content_media cm
         JOIN media_assets m ON m.id = cm.media_id
         JOIN content_items c ON c.id = cm.content_id
         LEFT JOIN media_translations mt ON mt.media_id = m.id
         WHERE c.status = 'published' AND (c.scheduled_at IS NULL OR c.scheduled_at <= CURRENT_TIMESTAMP)
         ORDER BY cm.content_id, cm.sort_order, mt.locale`;
    const mediaResult = await env.DB.prepare(mediaQuery).all();
    const translationsByContent = new Map<string, Record<string, unknown>[]>();
    for (const row of translationResult.results as Record<string, unknown>[]) {
      const contentId = String(row.content_id);
      const current = translationsByContent.get(contentId) ?? [];
      current.push({
        locale: row.locale,
        title: row.title,
        summary: row.summary,
        body: row.body,
        translationStatus: row.translation_status,
        sourceLocale: row.source_locale,
        sourceUpdatedAt: row.source_updated_at,
        translatedAt: row.translated_at,
        updatedAt: row.updated_at,
      });
      translationsByContent.set(contentId, current);
    }
    const mediaByContent = new Map<string, Map<string, Record<string, unknown>>>();
    for (const row of mediaResult.results as Record<string, unknown>[]) {
      const contentId = String(row.content_id);
      const mediaId = String(row.media_id);
      const contentAssets = mediaByContent.get(contentId) ?? new Map<string, Record<string, unknown>>();
      const asset = contentAssets.get(mediaId) ?? {
        id: mediaId,
        role: row.role,
        sortOrder: row.sort_order,
        storageKey: row.storage_key,
        url: `/media/${row.storage_key}`,
        kind: row.kind,
        mimeType: row.mime_type,
        originalFilename: row.original_filename,
        byteSize: row.byte_size,
        width: row.width,
        height: row.height,
        translations: [],
      };
      if (row.locale) {
        (asset.translations as Record<string, unknown>[]).push({
          locale: row.locale,
          altText: row.alt_text,
          caption: row.caption,
        });
      }
      contentAssets.set(mediaId, asset);
      mediaByContent.set(contentId, contentAssets);
    }
    let items = result.results.map((row: Record<string, unknown>) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      slug: row.slug,
      sourceLocale: row.source_locale,
      coverImageKey: row.cover_image_key,
      sortOrder: row.sort_order,
      featured: Boolean(row.featured),
      scheduledAt: row.scheduled_at,
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      translations: translationsByContent.get(String(row.id)) ?? [],
      media: Array.from(mediaByContent.get(String(row.id))?.values() ?? []),
    }));
    const type = url.searchParams.get("type")?.trim();
    const slug = url.searchParams.get("slug")?.trim();
    if (type) items = items.filter((item) => item.type === type);
    if (slug) items = items.filter((item) => item.slug === slug);
    if (studio) return json({ items });

    const localeRows = await env.DB.prepare(
      "SELECT code,is_default FROM supported_locales WHERE enabled=1 ORDER BY sort_order,code"
    ).all();
    const enabledLocales = localeRows.results.map((row: Record<string, unknown>) => String(row.code));
    const defaultLocale = String((localeRows.results as Record<string, unknown>[]).find((row) => Boolean(row.is_default))?.code ?? enabledLocales[0] ?? "es");
    const locale = resolveLocale(url.searchParams.get("locale"), request.headers.get("accept-language"), enabledLocales, defaultLocale);
    const page = boundedInteger(url.searchParams.get("page"), 1, 1, 100_000);
    const limit = boundedInteger(url.searchParams.get("limit"), 20, 1, 50);
    const total = items.length;
    items = items.slice((page - 1) * limit, page * limit).map((item) => {
      const preferred = item.translations.find((translation) => translation.locale === locale)
        ?? item.translations.find((translation) => translation.locale === defaultLocale)
        ?? item.translations.find((translation) => translation.locale === item.sourceLocale)
        ?? item.translations[0];
      const media = item.media.map((asset) => {
        const translations = asset.translations as Record<string, unknown>[];
        const preferredMedia = translations.find((translation) => translation.locale === locale)
          ?? translations.find((translation) => translation.locale === defaultLocale)
          ?? translations[0]
          ?? null;
        const publicAsset = { ...asset };
        delete publicAsset.translations;
        return { ...publicAsset, translation: preferredMedia };
      });
      const { translations: allTranslations, ...publicItem } = item;
      return {
        ...publicItem,
        locale,
        translation: preferred,
        availableLocales: allTranslations.map((translation) => translation.locale),
        media,
      };
    });
    return json({ locale, page, limit, total, items });
  }
  const payload = await request.json() as Record<string, unknown>;
  if (request.method === "DELETE") {
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!id) return json({ error: "Missing content id." }, 400);
    await env.DB.prepare("DELETE FROM content_items WHERE id = ?").bind(id).run();
    await audit(request, env, "delete", "content", id);
    return json({ deleted: id });
  }
  const values = contentValues(payload);
  const allowedTypes = new Set(["page", "post", "photo-note", "project"]);
  if (!allowedTypes.has(values.type)) return json({ error: "Unsupported content type." }, 400);
  if (values.translations.length > 20) return json({ error: "Too many translations in one request." }, 400);
  if (new Set(values.translations.map((translation) => translation.locale)).size !== values.translations.length) {
    return json({ error: "Each content locale can appear only once." }, 400);
  }
  const oversized = values.translations.find((translation) => translation.title.length > 300 || translation.summary.length > 2_000 || translation.body.length > 100_000);
  if (oversized) return json({ error: `Content is too long for locale ${oversized.locale}.` }, 400);
  if (!values.sourceLocale) return json({ error: "A valid sourceLocale is required." }, 400);
  const original = values.translations.find((translation) => translation.locale === values.sourceLocale);
  if (!original) return json({ error: "Original-language text is required." }, 400);
  const localeRows = await env.DB.prepare("SELECT code FROM supported_locales WHERE enabled = 1").all();
  const supported = new Set(localeRows.results.map((row: Record<string, unknown>) => String(row.code)));
  const unsupported = values.translations.find((translation) => !supported.has(translation.locale));
  if (unsupported) return json({ error: `Unsupported locale: ${unsupported.locale}` }, 400);

  if (request.method === "POST") {
    const id = crypto.randomUUID();
    const slug = slugify(original.title || original.body.slice(0, 80) || values.type, id);
    const publishedAt = values.status === "published" ? new Date().toISOString() : null;
    const statements = [
      env.DB.prepare("INSERT INTO content_items (id,type,status,slug,source_locale,cover_image_key,sort_order,featured,scheduled_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(id, values.type, values.status, slug, values.sourceLocale, values.coverImageKey, values.sortOrder, values.featured, values.scheduledAt, publishedAt),
      ...values.translations.map((translation) => env.DB.prepare(
        "INSERT INTO content_translations (content_id,locale,title,summary,body,translation_status,source_locale,source_updated_at,translated_at) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(
        id, translation.locale, translation.title, translation.summary, translation.body,
        translation.translationStatus, values.sourceLocale, new Date().toISOString(),
        translation.translationStatus === "machine" ? new Date().toISOString() : null,
      )),
      ...values.media.map((item) => env.DB.prepare(
        "INSERT INTO content_media (content_id,media_id,role,sort_order) VALUES (?,?,?,?)"
      ).bind(id, item.mediaId, item.role, item.sortOrder)),
    ];
    await env.DB.batch(statements);
    const translationJobs = await createAndProcessTranslationJobs(env, id);
    await audit(request, env, "create", "content", id, { type: values.type, status: values.status });
    return json({ item: { id, slug, ...values }, translationJobs }, 201);
  }
  if (request.method === "PUT") {
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!id) return json({ error: "Missing content id." }, 400);
    const publishedAt = values.status === "published" ? new Date().toISOString() : null;
    const statements = [
      env.DB.prepare("UPDATE content_items SET type=?,status=?,source_locale=?,cover_image_key=?,sort_order=?,featured=?,scheduled_at=?,published_at=COALESCE(published_at,?),updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(values.type, values.status, values.sourceLocale, values.coverImageKey, values.sortOrder, values.featured, values.scheduledAt, publishedAt, id),
      ...values.translations.map((translation) => env.DB.prepare(
        `INSERT INTO content_translations
          (content_id,locale,title,summary,body,translation_status,source_locale,source_updated_at,translated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(content_id,locale) DO UPDATE SET
          title=excluded.title,summary=excluded.summary,body=excluded.body,
          translation_status=excluded.translation_status,source_locale=excluded.source_locale,
          source_updated_at=excluded.source_updated_at,translated_at=excluded.translated_at,
          updated_at=CURRENT_TIMESTAMP`
      ).bind(
        id, translation.locale, translation.title, translation.summary, translation.body,
        translation.translationStatus, values.sourceLocale, new Date().toISOString(),
        translation.translationStatus === "machine" ? new Date().toISOString() : null,
      )),
    ];
    if (values.replaceMedia) {
      statements.push(env.DB.prepare("DELETE FROM content_media WHERE content_id = ?").bind(id));
      statements.push(...values.media.map((item) => env.DB.prepare(
        "INSERT INTO content_media (content_id,media_id,role,sort_order) VALUES (?,?,?,?)"
      ).bind(id, item.mediaId, item.role, item.sortOrder)));
    }
    await env.DB.batch(statements);
    const translationJobs = await createAndProcessTranslationJobs(env, id);
    await audit(request, env, "update", "content", id, { type: values.type, status: values.status });
    return json({ item: { id, ...values }, translationJobs });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function handleTechnologies(request: Request, env: Env) {
  if (request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id, name, category, created_at FROM technologies ORDER BY category, name"
    ).all();
    return json({
      technologies: result.results.map((row: Record<string, unknown>) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        createdAt: row.created_at,
      })),
    });
  }
  if (!isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  const payload = await request.json() as Record<string, unknown>;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";

  if (request.method === "POST" || request.method === "PUT") {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const category = typeof payload.category === "string" ? payload.category.trim() || "other" : "other";
    if (!name || name.length > 100) return json({ error: "A technology name of 100 characters or fewer is required." }, 400);
    if (category.length > 50) return json({ error: "Technology category is too long." }, 400);
    const duplicate = await env.DB.prepare(
      "SELECT id FROM technologies WHERE lower(name) = lower(?) AND id <> ?"
    ).bind(name, id).first<Record<string, unknown>>();
    if (duplicate) return json({ error: "Technology already exists." }, 409);
    if (request.method === "POST") {
      const technologyId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO technologies (id,name,category) VALUES (?,?,?)"
      ).bind(technologyId, name, category).run();
      await audit(request, env, "create", "technology", technologyId, { name, category });
      return json({ technology: { id: technologyId, name, category } }, 201);
    }
    if (!id) return json({ error: "Missing technology id." }, 400);
    const result = await env.DB.prepare(
      "UPDATE technologies SET name=?, category=? WHERE id=?"
    ).bind(name, category, id).run();
    if (!result.meta.changes) return json({ error: "Technology not found." }, 404);
    await audit(request, env, "update", "technology", id, { name, category });
    return json({ technology: { id, name, category } });
  }

  if (request.method === "DELETE") {
    if (!id) return json({ error: "Missing technology id." }, 400);
    const reference = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM project_technologies WHERE technology_id = ?"
    ).bind(id).first<Record<string, unknown>>();
    const referenceCount = Number(reference?.count ?? 0);
    if (referenceCount > 0) return json({ error: "Technology is still attached to projects.", references: referenceCount }, 409);
    const result = await env.DB.prepare("DELETE FROM technologies WHERE id = ?").bind(id).run();
    if (!result.meta.changes) return json({ error: "Technology not found." }, 404);
    await audit(request, env, "delete", "technology", id);
    return json({ deleted: id });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleProjects(request: Request, env: Env) {
  const url = new URL(request.url);
  const studio = url.searchParams.get("studio") === "1";
  if ((studio || request.method !== "GET") && !isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const visibility = studio ? "" : "AND c.status = 'published' AND (c.scheduled_at IS NULL OR c.scheduled_at <= CURRENT_TIMESTAMP)";
    const [projectResult, technologyResult, translationResult] = await Promise.all([
      env.DB.prepare(
        `SELECT pd.content_id, pd.project_status, pd.repository_url, pd.live_url,
                pd.started_at, pd.completed_at, pd.created_at, pd.updated_at,
                c.status AS content_status, c.slug
         FROM project_details pd
         JOIN content_items c ON c.id = pd.content_id
         WHERE c.type = 'project' ${visibility}
         ORDER BY c.updated_at DESC`
      ).all(),
      env.DB.prepare(
        `SELECT pt.content_id, t.id, t.name, t.category
         FROM project_technologies pt
         JOIN technologies t ON t.id = pt.technology_id
         JOIN content_items c ON c.id = pt.content_id
         WHERE c.type = 'project' ${visibility}
         ORDER BY t.category, t.name`
      ).all(),
      env.DB.prepare(
        `SELECT pt.content_id, pt.locale, pt.role, pt.updated_at
         FROM project_translations pt
         JOIN content_items c ON c.id = pt.content_id
         WHERE c.type = 'project' ${visibility}
         ORDER BY pt.locale`
      ).all(),
    ]);
    const technologiesByProject = new Map<string, Record<string, unknown>[]>();
    for (const row of technologyResult.results as Record<string, unknown>[]) {
      const contentId = String(row.content_id);
      const technologies = technologiesByProject.get(contentId) ?? [];
      technologies.push({ id: row.id, name: row.name, category: row.category });
      technologiesByProject.set(contentId, technologies);
    }
    const translationsByProject = new Map<string, Record<string, unknown>[]>();
    for (const row of translationResult.results as Record<string, unknown>[]) {
      const contentId = String(row.content_id);
      const translations = translationsByProject.get(contentId) ?? [];
      translations.push({ locale: row.locale, role: row.role, updatedAt: row.updated_at });
      translationsByProject.set(contentId, translations);
    }
    const projects = projectResult.results.map((row: Record<string, unknown>) => ({
        contentId: row.content_id,
        contentStatus: row.content_status,
        slug: row.slug,
        projectStatus: row.project_status,
        repositoryUrl: row.repository_url,
        liveUrl: row.live_url,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        technologies: technologiesByProject.get(String(row.content_id)) ?? [],
        translations: translationsByProject.get(String(row.content_id)) ?? [],
      }));
    if (studio) return json({ projects });
    const localeRows = await env.DB.prepare("SELECT code,is_default FROM supported_locales WHERE enabled=1 ORDER BY sort_order,code").all();
    const enabledLocales = localeRows.results.map((row: Record<string, unknown>) => String(row.code));
    const defaultLocale = String((localeRows.results as Record<string, unknown>[]).find((row) => Boolean(row.is_default))?.code ?? enabledLocales[0] ?? "es");
    const locale = resolveLocale(url.searchParams.get("locale"), request.headers.get("accept-language"), enabledLocales, defaultLocale);
    return json({
      locale,
      projects: projects.map((project) => {
        const translation = project.translations.find((entry) => entry.locale === locale)
          ?? project.translations.find((entry) => entry.locale === defaultLocale)
          ?? project.translations[0]
          ?? null;
        const { translations, ...publicProject } = project;
        return { ...publicProject, translation, availableLocales: translations.map((entry) => entry.locale) };
      }),
    });
  }
  if (request.method !== "PUT") return json({ error: "Method not allowed" }, 405);

  const payload = await request.json() as Record<string, unknown>;
  const contentId = typeof payload.contentId === "string" ? payload.contentId.trim() : "";
  if (!contentId) return json({ error: "Missing project content id." }, 400);
  const content = await env.DB.prepare(
    "SELECT id FROM content_items WHERE id = ? AND type = 'project'"
  ).bind(contentId).first<Record<string, unknown>>();
  if (!content) return json({ error: "Project content not found." }, 404);

  const projectStatuses = new Set(["concept", "active", "paused", "completed", "archived"]);
  const projectStatus = typeof payload.projectStatus === "string" && projectStatuses.has(payload.projectStatus)
    ? payload.projectStatus
    : "concept";
  const repositoryUrl = optionalHttpUrl(payload.repositoryUrl);
  const liveUrl = optionalHttpUrl(payload.liveUrl);
  if (repositoryUrl === "" || liveUrl === "") return json({ error: "Project URLs must use http or https." }, 400);
  const startedAt = typeof payload.startedAt === "string" ? payload.startedAt.trim() || null : null;
  const completedAt = typeof payload.completedAt === "string" ? payload.completedAt.trim() || null : null;
  const technologyIds = Array.isArray(payload.technologyIds)
    ? Array.from(new Set(payload.technologyIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim())))
    : [];
  const translations = Array.isArray(payload.translations)
    ? payload.translations.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const translation = entry as Record<string, unknown>;
      const locale = canonicalLocale(translation.locale);
      if (!locale) return [];
      return [{
        locale,
        role: typeof translation.role === "string" ? translation.role.trim().slice(0, 200) : "",
      }];
    })
    : [];
  if (new Set(translations.map((translation) => translation.locale)).size !== translations.length) {
    return json({ error: "Each project locale can appear only once." }, 400);
  }
  const localeRows = await env.DB.prepare("SELECT code FROM supported_locales WHERE enabled = 1").all();
  const supportedLocales = new Set(localeRows.results.map((row: Record<string, unknown>) => String(row.code)));
  const unsupportedLocale = translations.find((translation) => !supportedLocales.has(translation.locale));
  if (unsupportedLocale) return json({ error: `Unsupported locale: ${unsupportedLocale.locale}` }, 400);
  if (technologyIds.length) {
    const placeholders = technologyIds.map(() => "?").join(",");
    const existing = await env.DB.prepare(
      `SELECT id FROM technologies WHERE id IN (${placeholders})`
    ).bind(...technologyIds).all();
    if (existing.results.length !== technologyIds.length) return json({ error: "One or more technologies do not exist." }, 400);
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO project_details
        (content_id,project_status,role,repository_url,live_url,started_at,completed_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(content_id) DO UPDATE SET
        project_status=excluded.project_status,
        repository_url=excluded.repository_url,live_url=excluded.live_url,
        started_at=excluded.started_at,completed_at=excluded.completed_at,
        updated_at=CURRENT_TIMESTAMP`
    ).bind(contentId, projectStatus, "", repositoryUrl, liveUrl, startedAt, completedAt),
    env.DB.prepare("DELETE FROM project_technologies WHERE content_id = ?").bind(contentId),
    env.DB.prepare("DELETE FROM project_translations WHERE content_id = ?").bind(contentId),
    ...technologyIds.map((technologyId) => env.DB.prepare(
      "INSERT INTO project_technologies (content_id,technology_id) VALUES (?,?)"
    ).bind(contentId, technologyId)),
    ...translations.map((translation) => env.DB.prepare(
      "INSERT INTO project_translations (content_id,locale,role) VALUES (?,?,?)"
    ).bind(contentId, translation.locale, translation.role)),
  ]);
  await audit(request, env, "update", "project", contentId, { projectStatus, technologyIds });
  return json({
    project: { contentId, projectStatus, repositoryUrl, liveUrl, startedAt, completedAt, technologyIds, translations },
  });
}

async function handleSettings(request: Request, env: Env) {
  const url = new URL(request.url);
  const studio = url.searchParams.get("studio") === "1";
  if ((studio || request.method !== "GET") && !isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const result = await env.DB.prepare(
      studio
        ? "SELECT key, value, updated_at FROM site_settings ORDER BY key"
        : "SELECT key, value, updated_at FROM site_settings WHERE key LIKE 'public.%' ORDER BY key"
    ).all();
    return json({
      settings: result.results.map((row: Record<string, unknown>) => ({
        key: row.key,
        value: row.value,
        updatedAt: row.updated_at,
      })),
    });
  }
  const payload = await request.json() as Record<string, unknown>;
  const key = typeof payload.key === "string" ? payload.key.trim() : "";
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(key)) return json({ error: "Invalid setting key." }, 400);
  if (key.startsWith("secret.")) return json({ error: "Secrets must use environment variables, not site settings." }, 400);
  if (request.method === "PUT") {
    if (typeof payload.value !== "string" || payload.value.length > 20_000) return json({ error: "Setting value must be a string of 20,000 characters or fewer." }, 400);
    await env.DB.prepare(
      `INSERT INTO site_settings (key,value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`
    ).bind(key, payload.value).run();
    await audit(request, env, "update", "setting", key);
    return json({ setting: { key, value: payload.value } });
  }
  if (request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM site_settings WHERE key = ?").bind(key).run();
    if (!result.meta.changes) return json({ error: "Setting not found." }, 404);
    await audit(request, env, "delete", "setting", key);
    return json({ deleted: key });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function handleUpload(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  const data = await request.formData(); const file = data.get("file");
  if (!(file instanceof File)) return json({ error: "Selecciona una imagen." }, 400);
  const maxImageBytes = 20 * 1024 * 1024;
  if (file.size > maxImageBytes) return json({ error: "La imagen debe pesar 20 MB o menos." }, 400);

  const mimeByFormat: Record<string, string> = {
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  let imageInfo: { format: string; fileSize: number; width: number; height: number };
  try {
    imageInfo = await env.IMAGES.info(file.stream());
  } catch {
    return json({ error: "El archivo no es una imagen válida o compatible." }, 400);
  }
  const normalizedFormat = String(imageInfo.format).toLowerCase().replace(/^image\//, "").replace("jpg", "jpeg");
  const detectedMimeType = mimeByFormat[normalizedFormat];
  if (!detectedMimeType || imageInfo.width < 1 || imageInfo.height < 1) {
    return json({ error: "Usa una imagen JPEG, PNG, WebP, AVIF o GIF válida." }, 400);
  }
  if (imageInfo.width * imageInfo.height > 100_000_000) {
    return json({ error: "La resolución de la imagen es demasiado grande." }, 400);
  }

  const extension = normalizedFormat === "jpeg" ? "jpg" : normalizedFormat;
  const id = crypto.randomUUID();
  const key = `images/${id}.${extension}`;
  await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: detectedMimeType } });
  try {
    await env.DB.prepare(
      "INSERT INTO media_assets (id,storage_key,kind,mime_type,original_filename,byte_size,width,height) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(id, key, "image", detectedMimeType, file.name, file.size, imageInfo.width, imageInfo.height).run();
  } catch (error) {
    await env.BUCKET.delete(key);
    throw error;
  }
  await audit(request, env, "create", "asset", id, { key, mimeType: detectedMimeType, width: imageInfo.width, height: imageInfo.height });
  return json({
    asset: {
      id,
      key,
      url: `/media/${key}`,
      mimeType: detectedMimeType,
      byteSize: file.size,
      width: imageInfo.width,
      height: imageInfo.height,
    },
  }, 201);
}

async function handleMedia(request: Request, pathname: string, env: Env) {
  const key = decodeURIComponent(pathname.slice("/media/".length));
  const object = await env.BUCKET.get(key); if (!object) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const width = boundedInteger(url.searchParams.get("width"), 0, 0, 3840);
  const format = url.searchParams.get("format");
  const supportedFormat = format === "avif" || format === "webp" || format === "jpeg" ? format : "";
  if (width > 0 || supportedFormat) {
    const result = await env.IMAGES.input(object.body)
      .transform(width > 0 ? { width, fit: "scale-down" } : {})
      .output({ format: supportedFormat || "webp", quality: 82 });
    const response = await result.response();
    const headers = new Headers(response.headers);
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("vary", "accept");
    return new Response(response.body, { status: response.status, headers });
  }
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("etag", object.httpEtag); headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") return handleHealth(env);
    if (url.pathname === "/api/locales") return handleLocales(request, env);
    if (url.pathname === "/api/translations") return handleTranslations(request, env);
    if (url.pathname === "/api/audit") return handleAudit(request, env);
    if (url.pathname === "/api/assets") return handleAssets(request, env);
    if (url.pathname === "/api/content") return handleContent(request, env);
    if (url.pathname === "/api/projects") return handleProjects(request, env);
    if (url.pathname === "/api/settings") return handleSettings(request, env);
    if (url.pathname === "/api/technologies") return handleTechnologies(request, env);
    if (url.pathname === "/api/uploads") return handleUpload(request, env);
    if (url.pathname.startsWith("/media/")) return handleMedia(request, url.pathname, env);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
