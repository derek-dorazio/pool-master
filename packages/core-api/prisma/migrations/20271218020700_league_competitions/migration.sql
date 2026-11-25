-- League model slice 6b (#2153): a Competition level between Phase and Slot. A phase can hold
-- more than one competition (NCAA Men's Football's POSTSEASON holds the CFP and, with 13b, the
-- bowls), so slot definitions hang from a competition and Season slots from a Season competition.
-- Every existing phase gets one competition coded as the phase, so today's data is otherwise
-- unchanged; NCAA Men's Football's postseason competition is the CFP.

ALTER TYPE "PrismaLeaguePhase" ADD VALUE 'POSTSEASON_CONFERENCE' BEFORE 'POSTSEASON';

CREATE TYPE "PrismaSeasonCompetitionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');

-- Competitions (definition side).
CREATE TABLE "sport_league_competitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_league_id" UUID NOT NULL,
  "sport_league_phase_id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "order_index" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "sport_league_competitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sport_league_competitions_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT "sport_league_competitions_order_index" CHECK ("order_index" >= 1)
);
CREATE UNIQUE INDEX "sport_league_competitions_sport_league_id_code_key" ON "sport_league_competitions"("sport_league_id", "code");
CREATE UNIQUE INDEX "sport_league_competitions_sport_league_phase_id_order_index_key" ON "sport_league_competitions"("sport_league_phase_id", "order_index");
CREATE UNIQUE INDEX "sport_league_competitions_sport_league_id_id_key" ON "sport_league_competitions"("sport_league_id", "id");
CREATE UNIQUE INDEX "sport_league_competitions_sport_league_phase_id_id_key" ON "sport_league_competitions"("sport_league_phase_id", "id");
CREATE INDEX "sport_league_competitions_sport_league_id_sport_league_phas_idx" ON "sport_league_competitions"("sport_league_id", "sport_league_phase_id");
ALTER TABLE "sport_league_competitions"
  ADD CONSTRAINT "sport_league_competitions_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sport_league_competitions_sport_league_id_sport_league_pha_fkey" FOREIGN KEY ("sport_league_id", "sport_league_phase_id") REFERENCES "sport_league_phases"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One competition per existing phase, coded as the phase; NCAA Men's Football's postseason is the CFP.
INSERT INTO "sport_league_competitions" ("sport_league_id", "sport_league_phase_id", "code", "order_index", "updated_at")
SELECT p."sport_league_id", p."id",
  CASE WHEN p."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10' AND p."phase" = 'POSTSEASON' THEN 'CFP' ELSE p."phase"::text END,
  1, now()
FROM "sport_league_phases" p;

-- Season competitions, one for every competition of every Season phase.
CREATE TABLE "sport_league_season_competitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_league_id" UUID NOT NULL,
  "sport_league_season_id" UUID NOT NULL,
  "sport_league_phase_id" UUID NOT NULL,
  "sport_league_competition_id" UUID NOT NULL,
  "status" "PrismaSeasonCompetitionStatus" NOT NULL DEFAULT 'SCHEDULED',
  "champion_participant_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "sport_league_season_competitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sport_league_season_competitions_champion_when_completed" CHECK ("champion_participant_id" IS NULL OR "status" = 'COMPLETED')
);
CREATE UNIQUE INDEX "sport_league_season_competitions_sport_league_season_id_spo_key" ON "sport_league_season_competitions"("sport_league_season_id", "sport_league_competition_id");
CREATE UNIQUE INDEX "sport_league_season_competitions_sport_league_season_id_id_key" ON "sport_league_season_competitions"("sport_league_season_id", "id");
CREATE INDEX "sport_league_season_competitions_sport_league_id_sport_leag_idx" ON "sport_league_season_competitions"("sport_league_id", "sport_league_competition_id");
CREATE INDEX "sport_league_season_competitions_champion_participant_id_idx" ON "sport_league_season_competitions"("champion_participant_id");
ALTER TABLE "sport_league_season_competitions"
  ADD CONSTRAINT "sport_league_season_competitions_season_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_id") REFERENCES "sport_league_seasons"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sport_league_season_competitions_season_phase_fkey" FOREIGN KEY ("sport_league_season_id", "sport_league_phase_id") REFERENCES "sport_league_season_phases"("sport_league_season_id", "sport_league_phase_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sport_league_season_competitions_competition_fkey" FOREIGN KEY ("sport_league_phase_id", "sport_league_competition_id") REFERENCES "sport_league_competitions"("sport_league_phase_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sport_league_season_competitions_champion_fkey" FOREIGN KEY ("champion_participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "sport_league_season_competitions" ("sport_league_id", "sport_league_season_id", "sport_league_phase_id", "sport_league_competition_id", "updated_at")
SELECT sp."sport_league_id", sp."sport_league_season_id", sp."sport_league_phase_id", c."id", now()
FROM "sport_league_season_phases" sp
JOIN "sport_league_competitions" c ON c."sport_league_phase_id" = sp."sport_league_phase_id";

-- A Season phase's status; slice 14 (#2013) moves it.
ALTER TABLE "sport_league_season_phases" ADD COLUMN "status" "PrismaSeasonCompetitionStatus" NOT NULL DEFAULT 'SCHEDULED';

-- Slot definitions hang from a competition.
ALTER TABLE "sport_league_phase_slots" RENAME TO "sport_league_competition_slots";
ALTER TABLE "sport_league_competition_slots" ADD COLUMN "sport_league_competition_id" UUID;
UPDATE "sport_league_competition_slots" s SET "sport_league_competition_id" = c."id"
FROM "sport_league_competitions" c WHERE c."sport_league_phase_id" = s."sport_league_phase_id";
ALTER TABLE "sport_league_competition_slots" ALTER COLUMN "sport_league_competition_id" SET NOT NULL;
-- Drops the phase FK, its index and the two per-phase partial unique indexes with the column.
ALTER TABLE "sport_league_competition_slots" DROP COLUMN "sport_league_phase_id";
CREATE INDEX "sport_league_competition_slots_sport_league_id_sport_league_idx" ON "sport_league_competition_slots"("sport_league_id", "sport_league_competition_id");
ALTER TABLE "sport_league_competition_slots"
  ADD CONSTRAINT "sport_league_competition_slots_sport_league_id_sport_leagu_fkey" FOREIGN KEY ("sport_league_id", "sport_league_competition_id") REFERENCES "sport_league_competitions"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A week number, and every kind but WEEK and TOURNAMENT, is used once per competition.
CREATE UNIQUE INDEX "sport_league_competition_slots_one_of_kind" ON "sport_league_competition_slots"("sport_league_competition_id", "slot_kind") WHERE "slot_kind" NOT IN ('WEEK', 'TOURNAMENT');
CREATE UNIQUE INDEX "sport_league_competition_slots_one_week" ON "sport_league_competition_slots"("sport_league_competition_id", "week_number") WHERE "slot_kind" = 'WEEK';
ALTER TABLE "sport_league_competition_slots" RENAME CONSTRAINT "sport_league_phase_slots_pkey" TO "sport_league_competition_slots_pkey";
ALTER TABLE "sport_league_competition_slots" RENAME CONSTRAINT "sport_league_phase_slots_key_format" TO "sport_league_competition_slots_key_format";
ALTER TABLE "sport_league_competition_slots" RENAME CONSTRAINT "sport_league_phase_slots_periods" TO "sport_league_competition_slots_periods";
ALTER TABLE "sport_league_competition_slots" RENAME CONSTRAINT "sport_league_phase_slots_series_games" TO "sport_league_competition_slots_series_games";
ALTER TABLE "sport_league_competition_slots" RENAME CONSTRAINT "sport_league_phase_slots_week_number" TO "sport_league_competition_slots_week_number";
ALTER TABLE "sport_league_competition_slots" RENAME CONSTRAINT "sport_league_phase_slots_sport_league_id_fkey" TO "sport_league_competition_slots_sport_league_id_fkey";
ALTER INDEX "sport_league_phase_slots_sport_league_id_id_key" RENAME TO "sport_league_competition_slots_sport_league_id_id_key";
ALTER INDEX "sport_league_phase_slots_sport_league_id_key_key" RENAME TO "sport_league_competition_slots_sport_league_id_key_key";

-- Their provider mappings.
ALTER TABLE "sport_league_phase_slot_provider_mappings" RENAME TO "sport_league_competition_slot_provider_mappings";
ALTER TABLE "sport_league_competition_slot_provider_mappings" RENAME COLUMN "sport_league_phase_slot_id" TO "sport_league_competition_slot_id";
ALTER TABLE "sport_league_competition_slot_provider_mappings" RENAME CONSTRAINT "sport_league_phase_slot_provider_mappings_pkey" TO "sport_league_competition_slot_provider_mappings_pkey";
ALTER TABLE "sport_league_competition_slot_provider_mappings" RENAME CONSTRAINT "sport_league_phase_slot_provider_mappings_provider_mapping_fkey" TO "competition_slot_provider_mappings_provider_mapping_fkey";
ALTER TABLE "sport_league_competition_slot_provider_mappings" RENAME CONSTRAINT "sport_league_phase_slot_provider_mappings_slot_fkey" TO "competition_slot_provider_mappings_slot_fkey";
ALTER TABLE "sport_league_competition_slot_provider_mappings" RENAME CONSTRAINT "sport_league_phase_slot_provider_mappings_value" TO "competition_slot_provider_mappings_value";
ALTER INDEX "sport_league_phase_slot_provider_mappings_one_per_provider" RENAME TO "competition_slot_provider_mappings_one_per_provider";
ALTER INDEX "sport_league_phase_slot_provider_mappings_provider_mapping_idx" RENAME TO "competition_slot_provider_mappings_provider_mapping_idx";
ALTER INDEX "sport_league_phase_slot_provider_mappings_slot_idx" RENAME TO "competition_slot_provider_mappings_slot_idx";
ALTER INDEX "sport_league_phase_slot_provider_mappings_slot_provider_idx" RENAME TO "competition_slot_provider_mappings_slot_provider_idx";
ALTER INDEX "sport_league_phase_slot_provider_mappings_value_key" RENAME TO "competition_slot_provider_mappings_value_key";

-- Season slots hang from a Season competition.
ALTER TABLE "sport_league_season_phase_slots" RENAME TO "sport_league_season_competition_slots";
ALTER TABLE "sport_league_season_competition_slots" RENAME COLUMN "sport_league_phase_slot_id" TO "sport_league_competition_slot_id";
ALTER TABLE "sport_league_season_competition_slots" ADD COLUMN "sport_league_season_competition_id" UUID;
UPDATE "sport_league_season_competition_slots" s SET "sport_league_season_competition_id" = sc."id"
FROM "sport_league_competition_slots" d, "sport_league_season_competitions" sc
WHERE d."id" = s."sport_league_competition_slot_id"
  AND sc."sport_league_season_id" = s."sport_league_season_id"
  AND sc."sport_league_competition_id" = d."sport_league_competition_id";
ALTER TABLE "sport_league_season_competition_slots" ALTER COLUMN "sport_league_season_competition_id" SET NOT NULL;
-- Drops the Season phase FK and its index with the column.
ALTER TABLE "sport_league_season_competition_slots" DROP COLUMN "sport_league_season_phase_id";
CREATE INDEX "sport_league_season_competition_slots_season_competition_idx" ON "sport_league_season_competition_slots"("sport_league_season_id", "sport_league_season_competition_id");
ALTER TABLE "sport_league_season_competition_slots"
  ADD CONSTRAINT "sport_league_season_competition_slots_season_competition_fkey" FOREIGN KEY ("sport_league_season_id", "sport_league_season_competition_id") REFERENCES "sport_league_season_competitions"("sport_league_season_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sport_league_season_competition_slots" RENAME CONSTRAINT "sport_league_season_phase_slots_pkey" TO "sport_league_season_competition_slots_pkey";
ALTER TABLE "sport_league_season_competition_slots" RENAME CONSTRAINT "sport_league_season_phase_slots_dates" TO "sport_league_season_competition_slots_dates";
ALTER TABLE "sport_league_season_competition_slots" RENAME CONSTRAINT "sport_league_season_phase_slots_definition_fkey" TO "sport_league_season_competition_slots_definition_fkey";
ALTER TABLE "sport_league_season_competition_slots" RENAME CONSTRAINT "sport_league_season_phase_slots_season_fkey" TO "sport_league_season_competition_slots_season_fkey";
ALTER TABLE "sport_league_season_competition_slots" RENAME CONSTRAINT "sport_league_season_phase_slots_series_games" TO "sport_league_season_competition_slots_series_games";
ALTER TABLE "sport_league_season_competition_slots" RENAME CONSTRAINT "sport_league_season_phase_slots_test_label" TO "sport_league_season_competition_slots_test_label";
ALTER TABLE "sport_league_season_competition_slots" RENAME CONSTRAINT "sport_league_season_phase_slots_window" TO "sport_league_season_competition_slots_window";
ALTER INDEX "sport_league_season_phase_slots_definition_idx" RENAME TO "sport_league_season_competition_slots_definition_idx";
ALTER INDEX "sport_league_season_phase_slots_league_id_key" RENAME TO "sport_league_season_competition_slots_league_id_key";
ALTER INDEX "sport_league_season_phase_slots_one_synced" RENAME TO "sport_league_season_competition_slots_one_synced";
ALTER INDEX "sport_league_season_phase_slots_season_id_key" RENAME TO "sport_league_season_competition_slots_season_id_key";
ALTER INDEX "sport_league_season_phase_slots_test_label_key" RENAME TO "sport_league_season_competition_slots_test_label_key";

-- Their provider links.
ALTER TABLE "sport_league_season_phase_slot_provider_mappings" RENAME TO "sport_league_season_competition_slot_provider_mappings";
ALTER TABLE "sport_league_season_competition_slot_provider_mappings" RENAME COLUMN "sport_league_season_phase_slot_id" TO "sport_league_season_competition_slot_id";
ALTER TABLE "sport_league_season_competition_slot_provider_mappings" RENAME CONSTRAINT "sport_league_season_phase_slot_provider_mappings_pkey" TO "sport_league_season_competition_slot_provider_mappings_pkey";
ALTER TABLE "sport_league_season_competition_slot_provider_mappings" RENAME CONSTRAINT "sport_league_season_phase_slot_provider_mappings_mapping_fkey" TO "season_competition_slot_provider_mappings_mapping_fkey";
ALTER TABLE "sport_league_season_competition_slot_provider_mappings" RENAME CONSTRAINT "sport_league_season_phase_slot_provider_mappings_slot_fkey" TO "season_competition_slot_provider_mappings_slot_fkey";
ALTER INDEX "sport_league_season_phase_slot_provider_mappings_slot_idx" RENAME TO "season_competition_slot_provider_mappings_slot_idx";
ALTER INDEX "sport_league_season_phase_slot_provider_mappings_slot_key" RENAME TO "season_competition_slot_provider_mappings_slot_key";
ALTER INDEX "sport_league_season_phase_slot_provider_mappings_value_key" RENAME TO "season_competition_slot_provider_mappings_value_key";

-- The tables that point at slot definitions and Season slots.
ALTER TABLE "contest_config_template_slots" RENAME COLUMN "sport_league_phase_slot_id" TO "sport_league_competition_slot_id";
ALTER TABLE "event_page_offers" RENAME COLUMN "sport_league_phase_slot_id" TO "sport_league_competition_slot_id";
ALTER TABLE "sport_event_slots" RENAME COLUMN "sport_league_season_phase_slot_id" TO "sport_league_season_competition_slot_id";

-- The finding raised for a placed game whose competition the Season lacks.
ALTER TYPE "PrismaProviderSyncFindingKind" RENAME VALUE 'SLOT_SEASON_PHASE_MISSING' TO 'SLOT_SEASON_COMPETITION_MISSING';
ALTER INDEX "contest_config_template_slots_template_id_sport_league_phas_key" RENAME TO "contest_config_template_slots_template_id_sport_league_comp_key";
ALTER INDEX "event_page_offers_sport_league_id_sport_league_phase_slot_i_idx" RENAME TO "event_page_offers_sport_league_id_sport_league_competition__idx";

-- No contest crosses competitions. A ONE_SLOT contest covers one slot, so only ALL_LISTED and
-- FROM_SLOT templates are held to one competition. The two tennis knockout survivors listed the
-- tour Finals (POSTSEASON) after the regular season's events; they keep the regular season's.
DELETE FROM "contest_config_template_slots" ts
USING "contest_config_templates" t, "sport_league_competition_slots" s
WHERE ts."template_id" = t."id"
  AND ts."sport_league_competition_slot_id" = s."id"
  AND (t."sport_league_id", t."template_key", s."key") IN (
    ('6fa88e2c-e828-40f4-9ba1-be3302e54d18'::uuid, 'atp-knockout-survivor', 'ATP_FINALS'),
    ('89753830-f4b5-4c3e-8f30-8dac2465061b'::uuid, 'wta-knockout-survivor', 'WTA_FINALS')
  );
