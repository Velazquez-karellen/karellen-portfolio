/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  BUCKET: R2Bucket;
  ADMIN_EMAIL?: string;
  IMAGES: {
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

function isEditor(request: Request, env: Env) {
  const email = request.headers.get("oai-authenticated-user-email")?.toLowerCase();
  if (!email) return false;
  return !env.ADMIN_EMAIL || email === env.ADMIN_EMAIL.toLowerCase();
}

function contentValues(payload: Record<string, unknown>) {
  const value = (key: string) => typeof payload[key] === "string" ? String(payload[key]).trim() : "";
  return {
    type: value("type") || "post", status: value("status") === "published" ? "published" : "draft",
    titleEs: value("titleEs"), titleEn: value("titleEn"), summaryEs: value("summaryEs"), summaryEn: value("summaryEn"),
    bodyEs: value("bodyEs"), bodyEn: value("bodyEn"), coverImage: value("coverImage") || null,
  };
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
    const items = result.results.map((row: Record<string, unknown>) => ({
      id: row.id, type: row.type, status: row.status, slug: row.slug, titleEs: row.title_es, titleEn: row.title_en,
      summaryEs: row.summary_es, summaryEn: row.summary_en, bodyEs: row.body_es, bodyEn: row.body_en,
      coverImage: row.cover_image, createdAt: row.created_at, updatedAt: row.updated_at,
    }));
    return json({ items });
  }
  const payload = await request.json() as Record<string, unknown>;
  const values = contentValues(payload);
  if (!values.titleEs) return json({ error: "El título en español es requerido." }, 400);
  if (request.method === "POST") {
    const id = crypto.randomUUID();
    const base = values.titleEs.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const slug = `${base}-${id.slice(0, 6)}`;
    await env.DB.prepare("INSERT INTO content_items (id,type,status,slug,title_es,title_en,summary_es,summary_en,body_es,body_en,cover_image) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, values.type, values.status, slug, values.titleEs, values.titleEn, values.summaryEs, values.summaryEn, values.bodyEs, values.bodyEn, values.coverImage).run();
    return json({ item: { id, slug, ...values } }, 201);
  }
  if (request.method === "PUT") {
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!id) return json({ error: "Falta el identificador." }, 400);
    await env.DB.prepare("UPDATE content_items SET type=?,status=?,title_es=?,title_en=?,summary_es=?,summary_en=?,body_es=?,body_en=?,cover_image=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(values.type, values.status, values.titleEs, values.titleEn, values.summaryEs, values.summaryEn, values.bodyEs, values.bodyEn, values.coverImage, id).run();
    return json({ item: { id, ...values } });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function handleUpload(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isEditor(request, env)) return json({ error: "Unauthorized" }, 401);
  const data = await request.formData(); const file = data.get("file");
  if (!(file instanceof File)) return json({ error: "Selecciona una imagen." }, 400);
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return json({ error: "La imagen debe pesar menos de 10 MB." }, 400);
  const extension = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
  const key = `images/${crypto.randomUUID()}.${extension}`;
  await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  return json({ key, url: `/media/${key}` }, 201);
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
