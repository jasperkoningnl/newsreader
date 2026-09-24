ALTER TABLE `articles` ADD `opened_at` text;--> statement-breakpoint
ALTER TABLE `editions` ADD `kind` text DEFAULT 'daily' NOT NULL;