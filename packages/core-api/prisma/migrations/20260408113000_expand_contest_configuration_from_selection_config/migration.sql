ALTER TABLE "contest_configurations"
ADD COLUMN "rounds" INTEGER,
ADD COLUMN "time_per_pick_seconds" INTEGER,
ADD COLUMN "auto_pick_policy" VARCHAR(50),
ADD COLUMN "tier_config" JSONB,
ADD COLUMN "budget" INTEGER,
ADD COLUMN "pricing_method" VARCHAR(50),
ADD COLUMN "pick_count" INTEGER,
ADD COLUMN "is_exclusive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "picks_per_period" INTEGER,
ADD COLUMN "round_values" JSONB,
ADD COLUMN "start_round" VARCHAR(50);

UPDATE "contest_configurations" cc
SET
  "rounds" = sc."rounds",
  "time_per_pick_seconds" = sc."time_per_pick_seconds",
  "auto_pick_policy" = sc."auto_pick_policy",
  "tier_config" = sc."tier_config",
  "budget" = sc."budget",
  "pricing_method" = sc."pricing_method",
  "pick_count" = sc."pick_count",
  "is_exclusive" = COALESCE(sc."is_exclusive", false),
  "picks_per_period" = sc."picks_per_period",
  "round_values" = sc."round_values",
  "start_round" = sc."start_round",
  "roster_size" = COALESCE(cc."roster_size", sc."roster_size", sc."pick_count", sc."rounds")
FROM "selection_configs" sc
WHERE sc."contest_id" = cc."contest_id";

INSERT INTO "contest_configurations" (
  "id",
  "contest_id",
  "selection_type",
  "rounds",
  "time_per_pick_seconds",
  "auto_pick_policy",
  "tier_config",
  "budget",
  "pricing_method",
  "pick_count",
  "is_exclusive",
  "picks_per_period",
  "round_values",
  "start_round",
  "roster_size",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  sc."contest_id",
  sc."selection_type",
  sc."rounds",
  sc."time_per_pick_seconds",
  sc."auto_pick_policy",
  sc."tier_config",
  sc."budget",
  sc."pricing_method",
  sc."pick_count",
  COALESCE(sc."is_exclusive", false),
  sc."picks_per_period",
  sc."round_values",
  sc."start_round",
  COALESCE(sc."roster_size", sc."pick_count", sc."rounds"),
  sc."created_at",
  sc."updated_at"
FROM "selection_configs" sc
LEFT JOIN "contest_configurations" cc
  ON cc."contest_id" = sc."contest_id"
WHERE cc."id" IS NULL;
