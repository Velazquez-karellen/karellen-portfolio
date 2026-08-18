import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const supportedLocales = sqliteTable("supported_locales", {
  code: text("code").primaryKey(),
  englishName: text("english_name").notNull(),
  nativeName: text("native_name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  autoTranslate: integer("auto_translate", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const contentItems = sqliteTable("content_items", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull().default("draft"),
  slug: text("slug").notNull().unique(),
  sourceLocale: text("source_locale")
    .notNull()
    .default("es")
    .references(() => supportedLocales.code),
  coverImageKey: text("cover_image_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  scheduledAt: text("scheduled_at"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const contentTranslations = sqliteTable(
  "content_translations",
  {
    contentId: text("content_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    locale: text("locale")
      .notNull()
      .references(() => supportedLocales.code),
    title: text("title").notNull().default(""),
    summary: text("summary").notNull().default(""),
    body: text("body").notNull().default(""),
    translationStatus: text("translation_status").notNull().default("original"),
    sourceLocale: text("source_locale").notNull(),
    sourceUpdatedAt: text("source_updated_at"),
    translatedAt: text("translated_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.contentId, table.locale] }),
    index("content_translations_locale_idx").on(table.locale),
  ],
);

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  storageKey: text("storage_key").notNull().unique(),
  kind: text("kind").notNull().default("image"),
  mimeType: text("mime_type").notNull(),
  originalFilename: text("original_filename").notNull(),
  byteSize: integer("byte_size").notNull(),
  width: integer("width"),
  height: integer("height"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const mediaTranslations = sqliteTable(
  "media_translations",
  {
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    locale: text("locale")
      .notNull()
      .references(() => supportedLocales.code),
    altText: text("alt_text").notNull().default(""),
    caption: text("caption").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.mediaId, table.locale] })],
);

export const contentMedia = sqliteTable(
  "content_media",
  {
    contentId: text("content_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("gallery"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.contentId, table.mediaId] }),
    index("content_media_content_order_idx").on(table.contentId, table.sortOrder),
  ],
);

export const projectDetails = sqliteTable("project_details", {
  contentId: text("content_id")
    .primaryKey()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  projectStatus: text("project_status").notNull().default("concept"),
  role: text("role").notNull().default(""),
  repositoryUrl: text("repository_url"),
  liveUrl: text("live_url"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const technologies = sqliteTable("technologies", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  category: text("category").notNull().default("other"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projectTechnologies = sqliteTable(
  "project_technologies",
  {
    contentId: text("content_id")
      .notNull()
      .references(() => projectDetails.contentId, { onDelete: "cascade" }),
    technologyId: text("technology_id")
      .notNull()
      .references(() => technologies.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.contentId, table.technologyId] })],
);

export const siteSettings = sqliteTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
