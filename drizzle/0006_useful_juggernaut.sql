CREATE TABLE `link_signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`url_normalized` text NOT NULL,
	`title` text,
	`description` text,
	`image_url` text,
	`source_platform` text NOT NULL,
	`source_handle` text,
	`signal_type` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`external_id` text,
	`seen_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `link_signals_url_normalized_idx` ON `link_signals` (`url_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `link_signals_platform_external_unique` ON `link_signals` (`source_platform`,`external_id`);