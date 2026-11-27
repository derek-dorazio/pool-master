-- #2044 (slice 7b): team tiers, valuations and the tier and pricing settings move from the event
-- to the event slot. Every template's starting point today is its event's first slot in play
-- order, so each event's tiers, valuations and settings move onto that slot. The slot keeps the
-- settings as typed columns: the tier profile (the layout is the profile's) with any tier size an
-- admin sent, and the pricing profile with the five values the field was priced with. The old
-- event named its profiles by id (#2205); the slot keeps those, or its sport league's where one
-- was deleted, and the values the prices were made with are kept as they were.

-- New columns and tables.
ALTER TABLE "sport_event_slots" ADD COLUMN     "floor_share_percent" DOUBLE PRECISION,
ADD COLUMN     "platform_pricing_profile_id" UUID,
ADD COLUMN     "platform_tier_profile_id" UUID,
ADD COLUMN     "pricing_unit" INTEGER,
ADD COLUMN     "salary_cap" INTEGER,
ADD COLUMN     "steepness" DOUBLE PRECISION,
ADD COLUMN     "tier_size" INTEGER,
ADD COLUMN     "top_share_percent" DOUBLE PRECISION;

CREATE TABLE "sport_event_slot_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_slot_id" UUID NOT NULL,
    "tier_key" VARCHAR(50) NOT NULL,
    "tier_number" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_slot_tiers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sport_event_slot_participant_valuations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "sport_event_slot_id" UUID NOT NULL,
    "sport_event_participant_id" UUID NOT NULL,
    "sport_event_slot_tier_id" UUID,
    "tier_order_index" INTEGER,
    "tier_assigned_source" "ValuationSource",
    "price" DECIMAL(10,2),
    "price_assigned_source" "ValuationSource",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_slot_participant_valuations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sport_event_slot_tiers_sport_event_slot_id_tier_key_key" ON "sport_event_slot_tiers"("sport_event_slot_id", "tier_key");
CREATE UNIQUE INDEX "sport_event_slot_tiers_sport_event_slot_id_tier_number_key" ON "sport_event_slot_tiers"("sport_event_slot_id", "tier_number");
CREATE UNIQUE INDEX "sport_event_slot_tiers_slot_id_key" ON "sport_event_slot_tiers"("sport_event_slot_id", "id");
CREATE INDEX "sport_event_slot_participant_valuations_sport_event_slot_ti_idx" ON "sport_event_slot_participant_valuations"("sport_event_slot_tier_id", "tier_order_index");
CREATE INDEX "sport_event_slot_participant_valuations_sport_event_id_spor_idx" ON "sport_event_slot_participant_valuations"("sport_event_id", "sport_event_participant_id");
CREATE UNIQUE INDEX "sport_event_slot_participant_valuations_sport_event_slot_id_key" ON "sport_event_slot_participant_valuations"("sport_event_slot_id", "sport_event_participant_id");
CREATE INDEX "sport_event_slots_platform_tier_profile_id_idx" ON "sport_event_slots"("platform_tier_profile_id");
CREATE INDEX "sport_event_slots_platform_pricing_profile_id_idx" ON "sport_event_slots"("platform_pricing_profile_id");

ALTER TABLE "sport_event_slots" ADD CONSTRAINT "sport_event_slots_platform_tier_profile_id_fkey" FOREIGN KEY ("platform_tier_profile_id") REFERENCES "platform_tier_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sport_event_slots" ADD CONSTRAINT "sport_event_slots_platform_pricing_profile_id_fkey" FOREIGN KEY ("platform_pricing_profile_id") REFERENCES "platform_pricing_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sport_event_slot_tiers" ADD CONSTRAINT "sport_event_slot_tiers_sport_event_slot_id_fkey" FOREIGN KEY ("sport_event_slot_id") REFERENCES "sport_event_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sport_event_slot_participant_valuations" ADD CONSTRAINT "sport_event_slot_valuations_slot_fkey" FOREIGN KEY ("sport_event_id", "sport_event_slot_id") REFERENCES "sport_event_slots"("sport_event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sport_event_slot_participant_valuations" ADD CONSTRAINT "sport_event_slot_valuations_field_row_fkey" FOREIGN KEY ("sport_event_id", "sport_event_participant_id") REFERENCES "sport_event_participants"("sport_event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
-- NO ACTION, checked at the statement's end: a slot's delete cascades to its tiers and their
-- valuations together. Deleting a tier on its own still needs its valuations moved first.
ALTER TABLE "sport_event_slot_participant_valuations" ADD CONSTRAINT "sport_event_slot_valuations_tier_fkey" FOREIGN KEY ("sport_event_slot_id", "sport_event_slot_tier_id") REFERENCES "sport_event_slot_tiers"("sport_event_slot_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- The pricing columns are set together or not at all; a tier size only with a tier profile.
ALTER TABLE "sport_event_slots" ADD CONSTRAINT "sport_event_slots_pricing_together" CHECK (
  ("platform_pricing_profile_id" IS NULL AND "salary_cap" IS NULL AND "pricing_unit" IS NULL AND "top_share_percent" IS NULL AND "floor_share_percent" IS NULL AND "steepness" IS NULL)
  OR ("platform_pricing_profile_id" IS NOT NULL AND "salary_cap" IS NOT NULL AND "pricing_unit" IS NOT NULL AND "top_share_percent" IS NOT NULL AND "floor_share_percent" IS NOT NULL AND "steepness" IS NOT NULL)
);
ALTER TABLE "sport_event_slots" ADD CONSTRAINT "sport_event_slots_tier_size_with_profile" CHECK ("tier_size" IS NULL OR "platform_tier_profile_id" IS NOT NULL);

-- Each event's first slot in play order (compareSeasonSlots): tournaments by start date, then by
-- slot kind (the enum's order is play order), week number and key.
CREATE TEMP TABLE "first_event_slots" AS
SELECT DISTINCT ON (es."sport_event_id") es."sport_event_id", es."id" AS "sport_event_slot_id"
FROM "sport_event_slots" es
JOIN "sport_league_season_competition_slots" ss ON ss."id" = es."sport_league_season_competition_slot_id"
JOIN "sport_league_competition_slots" d ON d."id" = ss."sport_league_competition_slot_id"
ORDER BY es."sport_event_id",
  CASE WHEN d."slot_kind" = 'TOURNAMENT' THEN ss."starts_at" END ASC NULLS LAST,
  d."slot_kind", COALESCE(d."week_number", 0), ss."is_test_data", d."key", COALESCE(ss."label", '');

INSERT INTO "sport_event_slot_tiers" ("id", "sport_event_slot_id", "tier_key", "tier_number", "created_at", "updated_at")
SELECT t."id", f."sport_event_slot_id", t."tier_key", t."tier_number", t."created_at", t."updated_at"
FROM "sport_event_tiers" t
JOIN "first_event_slots" f ON f."sport_event_id" = t."sport_event_id";

INSERT INTO "sport_event_slot_participant_valuations" (
  "id", "sport_event_id", "sport_event_slot_id", "sport_event_participant_id", "sport_event_slot_tier_id",
  "tier_order_index", "tier_assigned_source", "price", "price_assigned_source", "created_at", "updated_at"
)
SELECT v."id", p."sport_event_id", f."sport_event_slot_id", v."sport_event_participant_id", v."sport_event_tier_id",
  v."tier_order_index", v."tier_assigned_source", v."price", v."price_assigned_source", v."created_at", v."updated_at"
FROM "sport_event_participant_valuations" v
JOIN "sport_event_participants" p ON p."id" = v."sport_event_participant_id"
JOIN "first_event_slots" f ON f."sport_event_id" = p."sport_event_id";

-- The settings: the profiles the event recorded by id (#2205), its sport league's where that
-- profile has since been deleted, any tier size the admin sent, and the pricing values used.
UPDATE "sport_event_slots" es
SET "platform_tier_profile_id" = CASE WHEN e."tier_config" IS NULL THEN NULL ELSE tp."id" END,
    "tier_size" = CASE
      WHEN e."tier_config" IS NOT NULL AND e."tier_config"->>'type' = 'EQUAL_GROUPS'
        AND (e."tier_config"->>'tierSize')::int IS DISTINCT FROM tp."tier_size"
      THEN (e."tier_config"->>'tierSize')::int END,
    "platform_pricing_profile_id" = CASE WHEN e."pricing_config" IS NULL THEN NULL ELSE COALESCE(e."platform_pricing_profile_id", l."platform_pricing_profile_id") END,
    "salary_cap" = (e."pricing_config"->>'salaryCap')::int,
    "pricing_unit" = (e."pricing_config"->>'unit')::int,
    "top_share_percent" = (e."pricing_config"->>'topSharePercent')::double precision,
    "floor_share_percent" = (e."pricing_config"->>'floorSharePercent')::double precision,
    "steepness" = (e."pricing_config"->>'steepness')::double precision
FROM "first_event_slots" f
JOIN "sport_events" e ON e."id" = f."sport_event_id"
JOIN "sport_leagues" l ON l."id" = e."sport_league_id"
JOIN "platform_tier_profiles" tp ON tp."id" = COALESCE(e."platform_tier_profile_id", l."platform_tier_profile_id")
WHERE es."id" = f."sport_event_slot_id"
  AND (e."tier_config" IS NOT NULL OR e."pricing_config" IS NOT NULL);

DROP TABLE "first_event_slots";

-- An event with no slot has nowhere to keep tiers: its tiers and valuations go with the old tables.
DROP TABLE "sport_event_participant_valuations";
DROP TABLE "sport_event_tiers";
ALTER TABLE "sport_events" DROP CONSTRAINT "sport_events_platform_pricing_profile_id_fkey";
ALTER TABLE "sport_events" DROP CONSTRAINT "sport_events_platform_tier_profile_id_fkey";
DROP INDEX "sport_events_platform_pricing_profile_id_idx";
DROP INDEX "sport_events_platform_tier_profile_id_idx";
ALTER TABLE "sport_events" DROP COLUMN "pricing_config",
DROP COLUMN "platform_pricing_profile_id",
DROP COLUMN "tier_config",
DROP COLUMN "platform_tier_profile_id";
