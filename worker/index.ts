/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  ADMIN_EMAIL?: string;
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
  return !env.ADMIN_EMAIL || email === env.ADMIN_EMAIL.toLowerCase();
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

function canonicalLocale(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    return Intl.getCanonicalLocales(value.trim())[0]?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}

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

function slugify(title: string, id: string) {
  const base = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "content";
  return `${base}-${id.slice(0, 6)}`;
}

async function handleLocales(env: Env) {
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

async function handleAssets(request: Request, env: Env) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  const result = await env.DB.prepare(
    "SELECT id, storage_key, kind, mime_type, original_filename, byte_size, width, height, created_at FROM media_assets ORDER BY created_at DESC"
  ).all();
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
    })),
  });
}

async function handleContent(request: Request, env: Env) {
  const url = new URL(request.url);
  const studio = url.searchParams.get("studio") === "1";
  if ((studio || request.method !== "GET") && !isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const query = studio
      ? "SELECT * FROM content_items ORDER BY updated_at DESC"
      : "SELECT * FROM content_items WHERE status = 'published' ORDER BY updated_at DESC";
    const result = await env.DB.prepare(query).all();
    const translationQuery = studio
      ? "SELECT t.* FROM content_translations t JOIN content_items c ON c.id = t.content_id ORDER BY t.locale"
      : "SELECT t.* FROM content_translations t JOIN content_items c ON c.id = t.content_id WHERE c.status = 'published' ORDER BY t.locale";
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
         WHERE c.status = 'published'
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
    const items = result.results.map((row: Record<string, unknown>) => ({
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
    return json({ items });
  }
  const payload = await request.json() as Record<string, unknown>;
  if (request.method === "DELETE") {
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!id) return json({ error: "Missing content id." }, 400);
    await env.DB.prepare("DELETE FROM content_items WHERE id = ?").bind(id).run();
    return json({ deleted: id });
  }
  const values = contentValues(payload);
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
    return json({ item: { id, slug, ...values } }, 201);
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
    return json({ item: { id, ...values } });
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

async function handleMedia(pathname: string, env: Env) {
  const key = decodeURIComponent(pathname.slice("/media/".length));
  const object = await env.BUCKET.get(key); if (!object) return new Response("Not found", { status: 404 });
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
    if (url.pathname === "/api/locales" && request.method === "GET") return handleLocales(env);
    if (url.pathname === "/api/assets") return handleAssets(request, env);
    if (url.pathname === "/api/content") return handleContent(request, env);
    if (url.pathname === "/api/uploads") return handleUpload(request, env);
    if (url.pathname.startsWith("/media/")) return handleMedia(url.pathname, env);

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
