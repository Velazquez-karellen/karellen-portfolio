CREATE TABLE `content_media` (
	`content_id` text NOT NULL,
	`media_id` text NOT NULL,
	`role` text DEFAULT 'gallery' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`content_id`, `media_id`),
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_media_content_order_idx` ON `content_media` (`content_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`kind` text DEFAULT 'image' NOT NULL,
	`mime_type` text NOT NULL,
	`original_filename` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_storage_key_unique` ON `media_assets` (`storage_key`);--> statement-breakpoint
CREATE TABLE `media_translations` (
	`media_id` text NOT NULL,
	`locale` text NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`media_id`, `locale`),
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locale`) REFERENCES `supported_locales`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_details` (
	`content_id` text PRIMARY KEY NOT NULL,
	`project_status` text DEFAULT 'concept' NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`repository_url` text,
	`live_url` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_technologies` (
	`content_id` text NOT NULL,
	`technology_id` text NOT NULL,
	PRIMARY KEY(`content_id`, `technology_id`),
	FOREIGN KEY (`content_id`) REFERENCES `project_details`(`content_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`technology_id`) REFERENCES `technologies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `site_settings` (`key`, `value`) VALUES
	('default_locale', '"es"'),
	('administration_mode', '"single_owner"'),
	('public_interaction', '"read_only"'),
	('automatic_translation', 'true');
--> statement-breakpoint
CREATE TABLE `technologies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `technologies_name_unique` ON `technologies` (`name`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_content_translations` (
	`content_id` text NOT NULL,
	`locale` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`translation_status` text DEFAULT 'original' NOT NULL,
	`source_locale` text NOT NULL,
	`source_updated_at` text,
	`translated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`content_id`, `locale`),
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locale`) REFERENCES `supported_locales`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_content_translations`("content_id", "locale", "title", "summary", "body", "translation_status", "source_locale", "source_updated_at", "translated_at", "created_at", "updated_at") SELECT "content_id", "locale", "title", "summary", "body", "translation_status", "source_locale", "source_updated_at", "translated_at", "created_at", "updated_at" FROM `content_translations`;--> statement-breakpoint
DROP TABLE `content_translations`;--> statement-breakpoint
ALTER TABLE `__new_content_translations` RENAME TO `content_translations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `content_translations_locale_idx` ON `content_translations` (`locale`);--> statement-breakpoint
ALTER TABLE `content_items` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `featured` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `content_items` ADD `scheduled_at` text;
