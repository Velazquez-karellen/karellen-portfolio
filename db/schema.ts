import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const contentItems = sqliteTable("content_items", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull().default("draft"),
  slug: text("slug").notNull().unique(),
  titleEs: text("title_es").notNull(),
  titleEn: text("title_en").notNull().default(""),
  summaryEs: text("summary_es").notNull().default(""),
  summaryEn: text("summary_en").notNull().default(""),
  bodyEs: text("body_es").notNull().default(""),
  bodyEn: text("body_en").notNull().default(""),
  coverImage: text("cover_image"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
