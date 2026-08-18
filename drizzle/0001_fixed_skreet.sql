PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `content_items` RENAME TO `legacy_content_items`;--> statement-breakpoint
DROP INDEX `content_items_slug_unique`;--> statement-breakpoint
CREATE TABLE `supported_locales` (
	`code` text PRIMARY KEY NOT NULL,
	`english_name` text NOT NULL,
	`native_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`auto_translate` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
INSERT INTO `supported_locales`
	(`code`, `english_name`, `native_name`, `enabled`, `is_default`, `auto_translate`, `sort_order`)
VALUES
	('es', 'Spanish', 'Español', 1, 1, 1, 10),
	('en', 'English', 'English', 1, 0, 1, 20);--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`slug` text NOT NULL,
	`source_locale` text DEFAULT 'es' NOT NULL,
	`cover_image_key` text,
	`published_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_locale`) REFERENCES `supported_locales`(`code`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `content_items_slug_unique` ON `content_items` (`slug`);--> statement-breakpoint
INSERT INTO `content_items`
	(`id`, `type`, `status`, `slug`, `source_locale`, `cover_image_key`, `published_at`, `created_at`, `updated_at`)
SELECT
	`id`, `type`, `status`, `slug`, 'es', `cover_image`,
	CASE WHEN `status` = 'published' THEN `updated_at` ELSE NULL END,
	`created_at`, `updated_at`
FROM `legacy_content_items`;--> statement-breakpoint
CREATE TABLE `content_translations` (
	`content_id` text NOT NULL,
	`locale` text NOT NULL,
	`title` text NOT NULL,
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
);--> statement-breakpoint
CREATE INDEX `content_translations_locale_idx` ON `content_translations` (`locale`);--> statement-breakpoint
INSERT INTO `content_translations`
	(`content_id`, `locale`, `title`, `summary`, `body`, `translation_status`, `source_locale`, `source_updated_at`)
SELECT
	`id`, 'es', `title_es`, `summary_es`, `body_es`, 'original', 'es', `updated_at`
FROM `legacy_content_items`
WHERE `title_es` <> '';--> statement-breakpoint
INSERT INTO `content_translations`
	(`content_id`, `locale`, `title`, `summary`, `body`, `translation_status`, `source_locale`, `source_updated_at`)
SELECT
	`id`, 'en', `title_en`, `summary_en`, `body_en`, 'reviewed', 'es', `updated_at`
FROM `legacy_content_items`
WHERE `title_en` <> '';--> statement-breakpoint
DROP TABLE `legacy_content_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
