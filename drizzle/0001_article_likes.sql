CREATE TABLE `article_likes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` integer NOT NULL,
	`source_id` integer,
	`topic` text,
	`liked` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `article_likes_article_id_idx` ON `article_likes` (`article_id`);
--> statement-breakpoint
CREATE INDEX `article_likes_source_id_idx` ON `article_likes` (`source_id`);
--> statement-breakpoint
CREATE INDEX `article_likes_topic_idx` ON `article_likes` (`topic`);
