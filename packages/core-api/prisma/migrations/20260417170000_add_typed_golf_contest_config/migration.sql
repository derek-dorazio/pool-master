ALTER TABLE "contest_configurations"
ADD COLUMN "config_mode" VARCHAR(50),
ADD COLUMN "config_json" JSONB;
