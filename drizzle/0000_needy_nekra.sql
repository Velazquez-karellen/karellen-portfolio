CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`slug` text NOT NULL,
	`title_es` text NOT NULL,
	`title_en` text DEFAULT '' NOT NULL,
	`summary_es` text DEFAULT '' NOT NULL,
	`summary_en` text DEFAULT '' NOT NULL,
	`body_es` text DEFAULT '' NOT NULL,
	`body_en` text DEFAULT '' NOT NULL,
	`cover_image` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_items_slug_unique` ON `content_items` (`slug`);