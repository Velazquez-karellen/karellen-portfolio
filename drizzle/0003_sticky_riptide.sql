CREATE TABLE `project_translations` (
	`content_id` text NOT NULL,
	`locale` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`content_id`, `locale`),
	FOREIGN KEY (`content_id`) REFERENCES `project_details`(`content_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locale`) REFERENCES `supported_locales`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_translations_locale_idx` ON `project_translations` (`locale`);