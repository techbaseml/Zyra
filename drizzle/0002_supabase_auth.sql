CREATE TABLE `auth_deletions` (
	`auth_subject` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `provider_tokens` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `provider_expires_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `refresh_lock_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `refresh_lock_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `auth_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_auth_subject_unique` ON `users` (`auth_subject`);