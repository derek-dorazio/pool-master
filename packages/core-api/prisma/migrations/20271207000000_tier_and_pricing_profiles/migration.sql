-- #1844: tier and pricing profiles are defined once for the platform, and each sport league names
-- one of each. Every layout in use today becomes a tier profile and every Budget pricing app
-- settings profile a pricing profile, and every league is pointed at what it uses now, so nothing
-- changes on screen. Then the league tier count and the Budget pricing app settings go.

-- CreateEnum
CREATE TYPE "PrismaTierProfileLastTier" AS ENUM ('ALL_REMAINING', 'CAPPED');

-- CreateTable
CREATE TABLE "tier_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(50) NOT NULL,
    "tier_count" INTEGER NOT NULL,
    "tier_size" INTEGER NOT NULL,
    "last_tier" "PrismaTierProfileLastTier" NOT NULL DEFAULT 'ALL_REMAINING',
    "last_tier_max" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(50) NOT NULL,
    "salary_cap" INTEGER NOT NULL,
    "unit" INTEGER NOT NULL,
    "top_share_percent" DOUBLE PRECISION NOT NULL,
    "floor_share_percent" DOUBLE PRECISION NOT NULL,
    "steepness" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pricing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tier_profiles_name_key" ON "tier_profiles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_profiles_name_key" ON "pricing_profiles"("name");

-- The same ranges the API checks (TierLayoutValuesSchema, BudgetPricingValuesSchema), and a cap
-- exactly when the last tier is capped.
ALTER TABLE "tier_profiles" ADD CONSTRAINT "tier_profiles_tier_count_range" CHECK ("tier_count" BETWEEN 1 AND 20);
ALTER TABLE "tier_profiles" ADD CONSTRAINT "tier_profiles_tier_size_range" CHECK ("tier_size" BETWEEN 1 AND 500);
ALTER TABLE "tier_profiles" ADD CONSTRAINT "tier_profiles_last_tier_max_when_capped"
  CHECK (("last_tier" = 'CAPPED') = ("last_tier_max" IS NOT NULL) AND ("last_tier_max" IS NULL OR "last_tier_max" BETWEEN 1 AND 500));
ALTER TABLE "pricing_profiles" ADD CONSTRAINT "pricing_profiles_values_range"
  CHECK ("salary_cap" >= 1 AND "unit" >= 1 AND "top_share_percent" > 0 AND "floor_share_percent" > 0
    AND "floor_share_percent" <= "top_share_percent" AND "steepness" > 0);

-- Each sport's former code default (SportDefinition.defaultTierLayout), the championship stat
-- pools' (6 x 5), and the leagues that set their own tier count: the College Football Playoff's
-- six and the PWHL's two, each a playoff of two teams a tier. Every last tier took all remaining.
INSERT INTO "tier_profiles" ("name", "tier_count", "tier_size", "updated_at") VALUES
  ('6 tiers of 10', 6, 10, now()),
  ('6 tiers of 8', 6, 8, now()),
  ('4 tiers of 16', 4, 16, now()),
  ('7 tiers of 2', 7, 2, now()),
  ('4 tiers of 3', 4, 3, now()),
  ('4 tiers of 4', 4, 4, now()),
  ('5 tiers of 8', 5, 8, now()),
  ('3 tiers of 3', 3, 3, now()),
  ('5 tiers of 10', 5, 10, now()),
  ('4 tiers of 6', 4, 6, now()),
  ('6 tiers of 5', 6, 5, now());
INSERT INTO "tier_profiles" ("name", "tier_count", "tier_size", "updated_at")
  SELECT DISTINCT "tier_count" || ' tiers of 2', "tier_count", 2, now()
  FROM "sport_leagues" WHERE "tier_count" IS NOT NULL
  ON CONFLICT ("name") DO NOTHING;

-- Every profile the Budget pricing app settings hold, in their order (a repeated name once); the
-- defaults the app used when the settings hold none.
INSERT INTO "pricing_profiles" ("name", "salary_cap", "unit", "top_share_percent", "floor_share_percent", "steepness", "updated_at")
  SELECT profile->>'name', (profile->>'salaryCap')::INTEGER, (profile->>'unit')::INTEGER,
    (profile->>'topSharePercent')::DOUBLE PRECISION, (profile->>'floorSharePercent')::DOUBLE PRECISION,
    (profile->>'steepness')::DOUBLE PRECISION, now()
  FROM "platform_runtime_configs", jsonb_array_elements("config_json"->'profiles') AS profile
  WHERE "config_key" = 'BUDGET_PRICING_CONFIG'
  ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pricing_profiles" ("name", "salary_cap", "unit", "top_share_percent", "floor_share_percent", "steepness", "updated_at")
  SELECT name, salary_cap, unit, top_share_percent, floor_share_percent, steepness, now()
  FROM (VALUES ('Standard', 50000, 100, 24.0, 12.0, 4.0), ('Small', 5000, 10, 24.0, 12.0, 4.0))
    AS defaults (name, salary_cap, unit, top_share_percent, floor_share_percent, steepness)
  WHERE NOT EXISTS (SELECT 1 FROM "pricing_profiles");

-- Every league names the layout it uses today, and the profile a field sync priced with: the
-- settings' first, Standard unless an admin reordered them.
ALTER TABLE "sport_leagues" ADD COLUMN "tier_profile_id" UUID, ADD COLUMN "pricing_profile_id" UUID;
UPDATE "sport_leagues" AS league SET "tier_profile_id" = profile."id"
FROM "sports" AS sport, "tier_profiles" AS profile
WHERE sport."id" = league."sport_id" AND profile."name" = CASE
  WHEN league."tier_count" IS NOT NULL THEN league."tier_count" || ' tiers of 2'
  WHEN league."scoring_family" = 'COMPOSITE' THEN '6 tiers of 5'
  ELSE CASE sport."sport"
    WHEN 'GOLF' THEN '6 tiers of 10'
    WHEN 'TENNIS' THEN '6 tiers of 8'
    WHEN 'BASKETBALL' THEN '4 tiers of 16'
    WHEN 'AMERICAN_FOOTBALL' THEN '7 tiers of 2'
    WHEN 'BASEBALL' THEN '4 tiers of 3'
    WHEN 'HOCKEY' THEN '4 tiers of 4'
    WHEN 'SOCCER' THEN '4 tiers of 4'
    WHEN 'AUTO_RACING' THEN '5 tiers of 8'
    WHEN 'HORSE_RACING' THEN '3 tiers of 3'
    WHEN 'CYCLING' THEN '5 tiers of 10'
    WHEN 'RUNNING' THEN '4 tiers of 6'
  END
END;
UPDATE "sport_leagues" SET "pricing_profile_id" = (
  SELECT "id" FROM "pricing_profiles" WHERE "name" = COALESCE(
    (SELECT "config_json"->'profiles'->0->>'name' FROM "platform_runtime_configs" WHERE "config_key" = 'BUDGET_PRICING_CONFIG'),
    'Standard'));
ALTER TABLE "sport_leagues" ALTER COLUMN "tier_profile_id" SET NOT NULL, ALTER COLUMN "pricing_profile_id" SET NOT NULL;
ALTER TABLE "sport_leagues" DROP COLUMN "tier_count";

-- CreateIndex
CREATE INDEX "sport_leagues_tier_profile_id_idx" ON "sport_leagues"("tier_profile_id");

-- CreateIndex
CREATE INDEX "sport_leagues_pricing_profile_id_idx" ON "sport_leagues"("pricing_profile_id");

-- AddForeignKey
ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_tier_profile_id_fkey" FOREIGN KEY ("tier_profile_id") REFERENCES "tier_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_pricing_profile_id_fkey" FOREIGN KEY ("pricing_profile_id") REFERENCES "pricing_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The layout a field was last auto-tiered with, recorded from now on.
ALTER TABLE "sport_events" ADD COLUMN "tier_config" JSONB;

-- The Budget pricing app settings group is gone; its profiles are the rows above.
DELETE FROM "platform_runtime_config_history" WHERE "config_key" = 'BUDGET_PRICING_CONFIG';
DELETE FROM "platform_runtime_configs" WHERE "config_key" = 'BUDGET_PRICING_CONFIG';
