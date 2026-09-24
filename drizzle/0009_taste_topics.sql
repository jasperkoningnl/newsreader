CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`manual_weight` integer,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_label_unique` ON `topics` (`label`);--> statement-breakpoint
ALTER TABLE `articles` ADD `topic_id` integer REFERENCES topics(id);