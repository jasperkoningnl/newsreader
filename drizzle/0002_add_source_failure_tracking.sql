ALTER TABLE `sources` ADD `consecutive_failures` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_failure_at` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `last_failure_reason` text;
