import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  feed_url: text("feed_url"),
  category: text("category"),
  active: integer("active").default(1),
  added_at: text("added_at").default(sql`(datetime('now'))`),
});

export const articles = sqliteTable("articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source_id: integer("source_id").references(() => sources.id),
  title: text("title").notNull(),
  url: text("url").notNull().unique(),
  description: text("description"),
  image_url: text("image_url"),
  published_at: text("published_at"),
  fetched_at: text("fetched_at").default(sql`(datetime('now'))`),
  category: text("category"),
  read: integer("read").default(0),
});

export const editions = sqliteTable("editions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  created_at: text("created_at").default(sql`(datetime('now'))`),
  items_json: text("items_json").notNull(),
});

export const taste_entries = sqliteTable("taste_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  type: text("type").notNull(),
  rating: integer("rating"),
  liked: integer("liked").default(1),
  notes: text("notes"),
  added_at: text("added_at").default(sql`(datetime('now'))`),
});

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type Edition = typeof editions.$inferSelect;
export type TasteEntry = typeof taste_entries.$inferSelect;
export type NewTasteEntry = typeof taste_entries.$inferInsert;
