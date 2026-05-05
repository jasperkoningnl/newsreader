CREATE TABLE `saved_articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` integer NOT NULL,
	`saved_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_articles_article_id_unique` ON `saved_articles` (`article_id`);