-- Tier and pricing profiles name their sources (#2160). Each profile gets its own ordered list of
-- the values a field is put in order by (ODDS, SEED, RANKING), and a tier profile gets a type:
-- EQUAL_GROUPS, as every profile is today, or RANGES, where each tier takes a range of seeds or
-- ranks. The NFL moves to a seed-ranges tier profile and a pricing profile that orders by seed,
-- and its tiered and budget templates become one pick-3 pair.

-- CreateEnum
CREATE TYPE "PrismaFieldOrderBasis" AS ENUM ('ODDS', 'SEED', 'RANKING');

-- CreateEnum
CREATE TYPE "PrismaTierProfileType" AS ENUM ('EQUAL_GROUPS', 'RANGES');

-- AlterTable
ALTER TABLE "platform_tier_profiles" ADD COLUMN     "type" "PrismaTierProfileType" NOT NULL DEFAULT 'EQUAL_GROUPS',
ALTER COLUMN "tier_count" DROP NOT NULL,
ALTER COLUMN "tier_size" DROP NOT NULL,
ALTER COLUMN "last_tier" DROP NOT NULL,
ALTER COLUMN "last_tier" DROP DEFAULT;

-- CreateTable
CREATE TABLE "platform_tier_profile_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_tier_profile_id" UUID NOT NULL,
    "order_index" INTEGER NOT NULL,
    "source" "PrismaFieldOrderBasis" NOT NULL,

    CONSTRAINT "platform_tier_profile_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_tier_profile_ranges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_tier_profile_id" UUID NOT NULL,
    "tier_number" INTEGER NOT NULL,
    "from_value" INTEGER NOT NULL,
    "to_value" INTEGER,

    CONSTRAINT "platform_tier_profile_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_pricing_profile_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_pricing_profile_id" UUID NOT NULL,
    "order_index" INTEGER NOT NULL,
    "source" "PrismaFieldOrderBasis" NOT NULL,

    CONSTRAINT "platform_pricing_profile_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_tier_profile_sources_order_key" ON "platform_tier_profile_sources"("platform_tier_profile_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "platform_tier_profile_sources_source_key" ON "platform_tier_profile_sources"("platform_tier_profile_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "platform_tier_profile_ranges_platform_tier_profile_id_tier__key" ON "platform_tier_profile_ranges"("platform_tier_profile_id", "tier_number");

-- CreateIndex
CREATE UNIQUE INDEX "platform_pricing_profile_sources_order_key" ON "platform_pricing_profile_sources"("platform_pricing_profile_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "platform_pricing_profile_sources_source_key" ON "platform_pricing_profile_sources"("platform_pricing_profile_id", "source");

-- AddForeignKey
ALTER TABLE "platform_tier_profile_sources" ADD CONSTRAINT "platform_tier_profile_sources_platform_tier_profile_id_fkey" FOREIGN KEY ("platform_tier_profile_id") REFERENCES "platform_tier_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_tier_profile_ranges" ADD CONSTRAINT "platform_tier_profile_ranges_platform_tier_profile_id_fkey" FOREIGN KEY ("platform_tier_profile_id") REFERENCES "platform_tier_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_pricing_profile_sources" ADD CONSTRAINT "platform_pricing_profile_sources_platform_pricing_profile__fkey" FOREIGN KEY ("platform_pricing_profile_id") REFERENCES "platform_pricing_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every existing profile was EQUAL_GROUPS; new rows name their type.
ALTER TABLE "platform_tier_profiles" ALTER COLUMN "type" DROP DEFAULT;

-- The EQUAL_GROUPS columns are set exactly on EQUAL_GROUPS rows.
ALTER TABLE "platform_tier_profiles" ADD CONSTRAINT "platform_tier_profiles_type_columns" CHECK (
  ("type" = 'EQUAL_GROUPS' AND "tier_count" IS NOT NULL AND "tier_size" IS NOT NULL AND "last_tier" IS NOT NULL)
  OR ("type" = 'RANGES' AND "tier_count" IS NULL AND "tier_size" IS NULL AND "last_tier" IS NULL AND "last_tier_max" IS NULL)
);
ALTER TABLE "platform_tier_profile_sources" ADD CONSTRAINT "platform_tier_profile_sources_order_index" CHECK ("order_index" >= 0);
ALTER TABLE "platform_pricing_profile_sources" ADD CONSTRAINT "platform_pricing_profile_sources_order_index" CHECK ("order_index" >= 0);
ALTER TABLE "platform_tier_profile_ranges" ADD CONSTRAINT "platform_tier_profile_ranges_values" CHECK (
  "tier_number" >= 1 AND "from_value" >= 1 AND ("to_value" IS NULL OR "to_value" >= "from_value")
);

-- Every existing profile orders as today: odds, then seed, then rank.
INSERT INTO "platform_tier_profile_sources" ("platform_tier_profile_id", "order_index", "source")
SELECT p."id", s."order_index", s."source"::"PrismaFieldOrderBasis"
FROM "platform_tier_profiles" p
CROSS JOIN (VALUES (0, 'ODDS'), (1, 'SEED'), (2, 'RANKING')) AS s("order_index", "source");

INSERT INTO "platform_pricing_profile_sources" ("platform_pricing_profile_id", "order_index", "source")
SELECT p."id", s."order_index", s."source"::"PrismaFieldOrderBasis"
FROM "platform_pricing_profiles" p
CROSS JOIN (VALUES (0, 'ODDS'), (1, 'SEED'), (2, 'RANKING')) AS s("order_index", "source");

-- An event's stored tier layout names its type; every layout stored so far was equal groups.
UPDATE "sport_events"
SET "tier_config" = "tier_config" || '{"type": "EQUAL_GROUPS"}'::jsonb
WHERE "tier_config" IS NOT NULL AND NOT ("tier_config" ? 'type');

-- Playoff seeds: the 1 seeds, the 2 to 4 seeds, then everyone from the 5 seed on.
INSERT INTO "platform_tier_profiles" ("code", "name", "type", "updated_at")
VALUES ('PLAYOFF_SEEDS_1_4_REST', 'Playoff seeds: 1, 2-4, 5+', 'RANGES', CURRENT_TIMESTAMP);

INSERT INTO "platform_tier_profile_ranges" ("platform_tier_profile_id", "tier_number", "from_value", "to_value")
SELECT p."id", r."tier_number", r."from_value", r."to_value"
FROM "platform_tier_profiles" p
CROSS JOIN (VALUES (1, 1, 1), (2, 2, 4), (3, 5, NULL::integer)) AS r("tier_number", "from_value", "to_value")
WHERE p."code" = 'PLAYOFF_SEEDS_1_4_REST';

INSERT INTO "platform_tier_profile_sources" ("platform_tier_profile_id", "order_index", "source")
SELECT p."id", s."order_index", s."source"::"PrismaFieldOrderBasis"
FROM "platform_tier_profiles" p
CROSS JOIN (VALUES (0, 'SEED'), (1, 'ODDS'), (2, 'RANKING')) AS s("order_index", "source")
WHERE p."code" = 'PLAYOFF_SEEDS_1_4_REST';

-- The standard prices, with the field ordered by seed first, so a seeded league's tier and pricing
-- profiles start with the same source.
INSERT INTO "platform_pricing_profiles" ("code", "name", "salary_cap", "unit", "top_share_percent", "floor_share_percent", "steepness", "updated_at")
SELECT 'STANDARD_BY_SEED', 'Standard, by seed', "salary_cap", "unit", "top_share_percent", "floor_share_percent", "steepness", CURRENT_TIMESTAMP
FROM "platform_pricing_profiles" WHERE "code" = 'STANDARD';

INSERT INTO "platform_pricing_profile_sources" ("platform_pricing_profile_id", "order_index", "source")
SELECT p."id", s."order_index", s."source"::"PrismaFieldOrderBasis"
FROM "platform_pricing_profiles" p
CROSS JOIN (VALUES (0, 'SEED'), (1, 'ODDS'), (2, 'RANKING')) AS s("order_index", "source")
WHERE p."code" = 'STANDARD_BY_SEED';

UPDATE "sport_leagues"
SET "platform_tier_profile_id" = (SELECT "id" FROM "platform_tier_profiles" WHERE "code" = 'PLAYOFF_SEEDS_1_4_REST'),
    "platform_pricing_profile_id" = (SELECT "id" FROM "platform_pricing_profiles" WHERE "code" = 'STANDARD_BY_SEED')
WHERE "url_segment" = 'nfl';

-- The NFL's tiered and budget templates become one pair: three teams, every one counting. Each
-- new template covers the slots the old default of its kind covered.
INSERT INTO "contest_config_templates" ("sport_league_id", "contest_type", "selection_type", "template_key", "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at", "coverage_mode")
SELECT t."sport_league_id", t."contest_type", t."selection_type", n."template_key", n."name", n."description", n."sort_order", false, true, n."config_json"::jsonb, t."schema_version", CURRENT_TIMESTAMP, t."coverage_mode"
FROM "contest_config_templates" t
JOIN (VALUES
  ('nfl-tiered-doubling', 'nfl-tiered-pick-3', 'Tiered: 1 team from each of 3 tiers, doubling points',
   'Pick one team from each tier: the 1 seeds, the 2 to 4 seeds, and the rest. A win scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl.',
   1, '{"scoring": {"config": {"upsetBonus": {"rule": "NONE"}, "roundValues": [1, 2, 4, 8]}, "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS"}, "picksPerTier": 1, "countedScores": 3, "selectionType": "TIERED", "maxEntriesPerSquad": 1}'),
  ('nfl-budget-doubling', 'nfl-budget-pick-3', 'Budget: 3 teams under the cap, doubling points',
   'Every team has a price: pick three whose prices fit under the salary cap. A win scores 1 point on Wild Card weekend, doubling each round to 8 for the Super Bowl.',
   2, '{"scoring": {"config": {"upsetBonus": {"rule": "NONE"}, "roundValues": [1, 2, 4, 8]}, "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS"}, "rosterSize": 3, "countedScores": 3, "selectionType": "BUDGET_PICK", "maxEntriesPerSquad": 1}')
) AS n("old_key", "template_key", "name", "description", "sort_order", "config_json") ON n."old_key" = t."template_key"
JOIN "sport_leagues" l ON l."id" = t."sport_league_id"
WHERE l."url_segment" = 'nfl';

INSERT INTO "contest_config_template_slots" ("sport_league_id", "template_id", "sport_league_phase_slot_id")
SELECT n."sport_league_id", n."id", s."sport_league_phase_slot_id"
FROM "contest_config_templates" n
JOIN "contest_config_templates" o ON o."sport_league_id" = n."sport_league_id"
  AND o."template_key" = CASE n."template_key" WHEN 'nfl-tiered-pick-3' THEN 'nfl-tiered-doubling' ELSE 'nfl-budget-doubling' END
JOIN "contest_config_template_slots" s ON s."template_id" = o."id"
WHERE n."template_key" IN ('nfl-tiered-pick-3', 'nfl-budget-pick-3')
  AND n."sport_league_id" = (SELECT "id" FROM "sport_leagues" WHERE "url_segment" = 'nfl');

DELETE FROM "contest_config_templates"
WHERE "template_key" IN ('nfl-tiered-doubling', 'nfl-tiered-doubling-upset-bonus', 'nfl-budget-doubling', 'nfl-budget-doubling-upset-bonus')
  AND "sport_league_id" = (SELECT "id" FROM "sport_leagues" WHERE "url_segment" = 'nfl');

-- Each new template is its kind's default, now that the old defaults are gone.
UPDATE "contest_config_templates" SET "is_default" = true
WHERE "template_key" IN ('nfl-tiered-pick-3', 'nfl-budget-pick-3')
  AND "sport_league_id" = (SELECT "id" FROM "sport_leagues" WHERE "url_segment" = 'nfl');
