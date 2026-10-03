CREATE TABLE `user_preferences` (
  `id` text PRIMARY KEY NOT NULL,
  `key` text NOT NULL,
  `value_json` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `user_preferences_key_nonempty` CHECK (length(trim(`key`)) > 0),
  CONSTRAINT `user_preferences_value_json_valid` CHECK (json_valid(`value_json`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_preferences_key_unique` ON `user_preferences` (`key`);
--> statement-breakpoint
CREATE INDEX `user_preferences_updated_at_idx` ON `user_preferences` (`updated_at`);
