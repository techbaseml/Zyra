CREATE TABLE `provider_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`day` text NOT NULL,
	`budget` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_usage_day` ON `provider_usage` (`provider`,`day`);--> statement-breakpoint
CREATE INDEX `provider_usage_time` ON `provider_usage` (`provider`,`created_at`);