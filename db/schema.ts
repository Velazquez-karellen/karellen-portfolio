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
    title: text("title").notNull(),
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
