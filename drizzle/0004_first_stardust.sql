CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`actor_email` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_log_created_idx` ON `admin_audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `translation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`target_locale` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_locale`) REFERENCES `supported_locales`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `translation_jobs_content_idx` ON `translation_jobs` (`content_id`);--> statement-breakpoint
CREATE INDEX `translation_jobs_status_idx` ON `translation_jobs` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `content_items_publication_idx` ON `content_items` (`status`,`type`,`published_at`);--> statement-breakpoint
CREATE INDEX `content_items_schedule_idx` ON `content_items` (`status`,`scheduled_at`);