import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  feed_url: text("feed_url"),
  category: text("category"),
  active: integer("active").default(1),
  is_paywall: integer("is_paywall").default(0),
  added_at: text("added_at").default(sql`(datetime('now'))`),
  consecutive_failures: integer("consecutive_failures").default(0),
  last_failure_at: text("last_failure_at"),
  last_failure_reason: text("last_failure_reason"),
});

export const topics = sqliteTable("topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull().unique(),
  manual_weight: integer("manual_weight"),
  created_at: text("created_at").default(sql`(datetime('now'))`),
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
  is_paywall: integer("is_paywall"),
  paywall_checked_at: text("paywall_checked_at"),
  signal_score: real("signal_score").default(0),
  topic_id: integer("topic_id").references(() => topics.id),
});

export const editions = sqliteTable("editions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  created_at: text("created_at").default(sql`(datetime('now'))`),
  items_json: text("items_json").notNull(),
});

export const article_likes = sqliteTable("article_likes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  article_id: integer("article_id").notNull().references(() => articles.id),
  source_id: integer("source_id").references(() => sources.id),
  topic: text("topic"),
  liked: integer("liked").default(1),
  created_at: text("created_at").default(sql`(datetime('now'))`),
});

export const saved_articles = sqliteTable("saved_articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  article_id: integer("article_id").notNull().unique().references(() => articles.id),
  saved_at: text("saved_at").default(sql`(datetime('now'))`),
});

export const link_signals = sqliteTable(
  "link_signals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    url: text("url").notNull(),
    url_normalized: text("url_normalized").notNull(),
    title: text("title"),
    description: text("description"),
    image_url: text("image_url"),
    source_platform: text("source_platform").notNull(),
    source_handle: text("source_handle"),
    signal_type: text("signal_type").notNull(),
    weight: real("weight").notNull().default(1),
    external_id: text("external_id"),
    seen_at: text("seen_at").default(sql`(datetime('now'))`),
  },
  (t) => ({
    url_normalized_idx: index("link_signals_url_normalized_idx").on(t.url_normalized),
    platform_external_unique: uniqueIndex("link_signals_platform_external_unique").on(
      t.source_platform,
      t.external_id,
    ),
  }),
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type Edition = typeof editions.$inferSelect;
export type ArticleLike = typeof article_likes.$inferSelect;
export type NewArticleLike = typeof article_likes.$inferInsert;
export type SavedArticle = typeof saved_articles.$inferSelect;
export type NewSavedArticle = typeof saved_articles.$inferInsert;
export type LinkSignal = typeof link_signals.$inferSelect;
export type NewLinkSignal = typeof link_signals.$inferInsert;
