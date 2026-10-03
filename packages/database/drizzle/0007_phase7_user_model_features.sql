CREATE TABLE "user_model_features" (
  "id" text PRIMARY KEY NOT NULL,
  "feature_key" text NOT NULL,
  "scope_key" text DEFAULT '' NOT NULL,
  "numeric_value" real NOT NULL,
  "window_start" text NOT NULL,
  "window_end" text NOT NULL,
  "source_state_version" integer NOT NULL,
  "sample_count" integer NOT NULL,
  "confidence" real NOT NULL,
  "algorithm_version" text NOT NULL,
  "last_updated_at" text NOT NULL,
  CONSTRAINT "user_model_features_feature_key_nonempty" CHECK (length(trim("feature_key")) > 0),
  CONSTRAINT "user_model_features_scope_key_trimmed" CHECK ("scope_key" = trim("scope_key")),
  CONSTRAINT "user_model_features_numeric_finite" CHECK ("numeric_value" = "numeric_value" and abs("numeric_value") <= 9007199254740991),
  CONSTRAINT "user_model_features_window_valid" CHECK ("window_end" > "window_start"),
  CONSTRAINT "user_model_features_source_version_nonnegative" CHECK ("source_state_version" >= 0),
  CONSTRAINT "user_model_features_sample_count_nonnegative" CHECK ("sample_count" >= 0),
  CONSTRAINT "user_model_features_confidence_valid" CHECK ("confidence" >= 0 and "confidence" <= 1),
  CONSTRAINT "user_model_features_algorithm_nonempty" CHECK (length(trim("algorithm_version")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_model_features_identity_unique" ON "user_model_features" ("algorithm_version", "feature_key", "scope_key");
--> statement-breakpoint
CREATE INDEX "user_model_features_algorithm_updated_idx" ON "user_model_features" ("algorithm_version", "last_updated_at");
--> statement-breakpoint
CREATE INDEX "user_model_features_source_version_idx" ON "user_model_features" ("source_state_version");
