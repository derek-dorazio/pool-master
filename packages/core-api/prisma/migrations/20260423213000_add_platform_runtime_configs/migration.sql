CREATE TABLE "platform_runtime_configs" (
  "id" UUID NOT NULL,
  "config_key" VARCHAR(100) NOT NULL,
  "config_json" JSONB NOT NULL,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_runtime_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_runtime_configs_config_key_key"
  ON "platform_runtime_configs"("config_key");

