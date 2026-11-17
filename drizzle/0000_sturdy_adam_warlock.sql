CREATE TABLE `monitor_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`owner` text NOT NULL,
	`checked_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monitor_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`lease_until` text
);
