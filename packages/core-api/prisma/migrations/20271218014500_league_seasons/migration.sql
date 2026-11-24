-- League model 6 (#2003, plans/league-model-redesign.md §2 and §6): each sport league's real
-- Seasons, set here and never computed from a clock. A Season has its name, championship year and
-- date span, its provider season ids, one row per phase and one per slot of each synced phase
-- (TOURNAMENT slots are added by the sync when the first tournament matches, slice 12). Events
-- move from a bare event year onto their Season; the hand-set current year becomes the current
-- Season, recomputed daily by one rule. Each league gets the time zone its calendar weeks break in.

-- CreateEnum
CREATE TYPE "PrismaSeasonSlotStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'SEASON_MISSING';

-- CreateTable
CREATE TABLE "sport_league_seasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "championship_year" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_league_season_provider_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_league_season_id" UUID NOT NULL,
    "sport_league_provider_mapping_id" UUID NOT NULL,
    "provider_season_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_season_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_league_season_phases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_league_season_id" UUID NOT NULL,
    "sport_league_phase_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_season_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_league_season_phase_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_league_season_id" UUID NOT NULL,
    "sport_league_season_phase_id" UUID NOT NULL,
    "sport_league_phase_slot_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "status" "PrismaSeasonSlotStatus" NOT NULL DEFAULT 'SCHEDULED',
    "series_format" "PrismaSeriesFormat" NOT NULL,
    "series_games" INTEGER NOT NULL,
    "pairing" "PrismaSlotPairing" NOT NULL,
    "is_test_data" BOOLEAN NOT NULL DEFAULT false,
    "label" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_season_phase_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_seasons_sport_league_id_championship_year_key" ON "sport_league_seasons"("sport_league_id", "championship_year");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_seasons_sport_league_id_id_key" ON "sport_league_seasons"("sport_league_id", "id");

-- CreateIndex
CREATE INDEX "sport_league_season_provider_mappings_season_idx" ON "sport_league_season_provider_mappings"("sport_league_id", "sport_league_season_id");

-- CreateIndex
CREATE INDEX "sport_league_season_provider_mappings_provider_mapping_idx" ON "sport_league_season_provider_mappings"("sport_league_id", "sport_league_provider_mapping_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_season_provider_mappings_value_key" ON "sport_league_season_provider_mappings"("sport_league_provider_mapping_id", "provider_season_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_season_provider_mappings_season_provider_key" ON "sport_league_season_provider_mappings"("sport_league_season_id", "sport_league_provider_mapping_id");

-- CreateIndex
CREATE INDEX "sport_league_season_phases_sport_league_id_sport_league_pha_idx" ON "sport_league_season_phases"("sport_league_id", "sport_league_phase_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_season_phases_sport_league_season_id_sport_lea_key" ON "sport_league_season_phases"("sport_league_season_id", "sport_league_phase_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_season_phases_sport_league_season_id_id_key" ON "sport_league_season_phases"("sport_league_season_id", "id");

-- CreateIndex
CREATE INDEX "sport_league_season_phase_slots_season_phase_idx" ON "sport_league_season_phase_slots"("sport_league_season_id", "sport_league_season_phase_id");

-- CreateIndex
CREATE INDEX "sport_league_season_phase_slots_definition_idx" ON "sport_league_season_phase_slots"("sport_league_id", "sport_league_phase_slot_id");

-- AddForeignKey
ALTER TABLE "sport_league_seasons" ADD CONSTRAINT "sport_league_seasons_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_provider_mappings" ADD CONSTRAINT "sport_league_season_provider_mappings_season_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_id") REFERENCES "sport_league_seasons"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_provider_mappings" ADD CONSTRAINT "sport_league_season_provider_mappings_provider_mapping_fkey" FOREIGN KEY ("sport_league_id", "sport_league_provider_mapping_id") REFERENCES "sport_league_provider_mappings"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_phases" ADD CONSTRAINT "sport_league_season_phases_season_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_id") REFERENCES "sport_league_seasons"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_phases" ADD CONSTRAINT "sport_league_season_phases_phase_fkey" FOREIGN KEY ("sport_league_id", "sport_league_phase_id") REFERENCES "sport_league_phases"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_phase_slots" ADD CONSTRAINT "sport_league_season_phase_slots_season_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_id") REFERENCES "sport_league_seasons"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_phase_slots" ADD CONSTRAINT "sport_league_season_phase_slots_season_phase_fkey" FOREIGN KEY ("sport_league_season_id", "sport_league_season_phase_id") REFERENCES "sport_league_season_phases"("sport_league_season_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_phase_slots" ADD CONSTRAINT "sport_league_season_phase_slots_definition_fkey" FOREIGN KEY ("sport_league_id", "sport_league_phase_slot_id") REFERENCES "sport_league_phase_slots"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What the schema cannot say.
ALTER TABLE "sport_league_seasons"
  ADD CONSTRAINT "sport_league_seasons_span" CHECK ("ends_at" > "starts_at");
ALTER TABLE "sport_league_season_phase_slots"
  ADD CONSTRAINT "sport_league_season_phase_slots_test_label" CHECK ("is_test_data" = ("label" IS NOT NULL)),
  ADD CONSTRAINT "sport_league_season_phase_slots_dates" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" >= "starts_at"),
  ADD CONSTRAINT "sport_league_season_phase_slots_series_games" CHECK (
    ("series_format" = 'SINGLE_GAME' AND "series_games" = 1)
    OR ("series_format" = 'BEST_OF' AND "series_games" >= 3 AND "series_games" % 2 = 1)
    OR ("series_format" = 'AGGREGATE' AND "series_games" >= 2));
-- A definition is played once a Season, and has any number of test slots, each label once.
CREATE UNIQUE INDEX "sport_league_season_phase_slots_one_synced" ON "sport_league_season_phase_slots" ("sport_league_season_id", "sport_league_phase_slot_id") WHERE NOT "is_test_data";
CREATE UNIQUE INDEX "sport_league_season_phase_slots_test_label_key" ON "sport_league_season_phase_slots" ("sport_league_season_id", "sport_league_phase_slot_id", "label") WHERE "is_test_data";

-- Each league's time zone. A league this list does not name (one a test database made) breaks
-- its weeks in UTC.
ALTER TABLE "sport_leagues" ADD COLUMN "time_zone" VARCHAR(64);
UPDATE "sport_leagues" sl SET "time_zone" = z.tz
FROM (VALUES
  ('2d39e488-42b8-4354-b8ca-47852b8a60b5', 'America/New_York'),
  ('c4d2cda5-f6df-4156-8fc2-26bfb5b3352d', 'America/New_York'),
  ('52231de6-f739-43ff-b731-d5c86776beb8', 'America/New_York'),
  ('7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37', 'UTC'),
  ('5eb10869-d5c2-4127-b549-037ab914d97e', 'America/New_York'),
  ('b558b79e-be53-4741-a309-00be94c641ec', 'America/New_York'),
  ('ec21ed6c-3bf8-495c-867e-50d2561fddb2', 'Europe/Paris'),
  ('f8dc8a57-ebda-4d61-b78b-03f2db8ac164', 'Europe/Paris'),
  ('b7bee9c9-e7b0-44be-9d9d-630a8340dcf5', 'UTC'),
  ('3e2c8242-5991-4281-ad57-7a955f179fd1', 'UTC'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', 'America/New_York'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', 'America/New_York'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', 'America/New_York'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61', 'America/New_York'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', 'America/New_York'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'America/New_York'),
  ('991e40bf-cf2c-440e-b983-3d5d88ffa782', 'America/New_York'),
  ('b195b4bc-9275-49fa-9442-5c2c651ca317', 'America/New_York'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', 'America/New_York'),
  ('b9dc046c-93de-4b7e-8e3a-659455b46d6b', 'America/Toronto'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', 'America/New_York'),
  ('acba33f8-d08b-40e9-9686-54263d3622ec', 'America/New_York'),
  ('6e593fe5-2c26-4992-9631-c5a832c1e001', 'America/Sao_Paulo'),
  ('1015d5a8-22d1-482d-ba6a-d41c672e32b8', 'America/New_York'),
  ('1d4245e7-27e5-4386-bb2f-fad87ef7b8e5', 'America/New_York'),
  ('a91d9af2-757f-4d46-845f-fbd621a2ce6d', 'America/New_York'),
  ('28014434-2aa7-4950-af84-f952a7e81f42', 'America/New_York'),
  ('831d8e9a-4eb3-4afc-b1ae-1b71d436ca18', 'America/New_York'),
  ('93c2508a-a52e-4d1d-beee-796bc14c9fe2', 'Europe/London'),
  ('5e1930aa-989b-4b92-85f0-a3d604f4a546', 'Europe/Paris'),
  ('f8f6171f-64af-4ab6-81cf-0c81973ed459', 'Europe/Paris'),
  ('6fa88e2c-e828-40f4-9ba1-be3302e54d18', 'UTC'),
  ('bc8c3afb-4a18-4bbf-ae4b-79d94b795ab6', 'America/New_York'),
  ('0ee056ee-ae8b-400d-ba8d-b88e944ff8d3', 'America/New_York'),
  ('89753830-f4b5-4c3e-8f30-8dac2465061b', 'UTC')
) AS z(league, tz)
WHERE sl."id" = z.league::uuid;
UPDATE "sport_leagues" SET "time_zone" = 'UTC' WHERE "time_zone" IS NULL;
ALTER TABLE "sport_leagues" ALTER COLUMN "time_zone" SET NOT NULL;

-- Seasons: for each league the one before today's, today's and the next; an international
-- tournament has one per edition. A Season starts at midnight and ends at the end of its last day
-- in its league's time zone. BALLDONTLIE names a season by the year it starts.
INSERT INTO "sport_league_seasons" ("sport_league_id", "name", "championship_year", "starts_at", "ends_at", "updated_at")
SELECT sl."id", s.name, s.year, s.starts::date::timestamp AT TIME ZONE sl."time_zone",
  (s.ends::date + 1)::timestamp AT TIME ZONE sl."time_zone" - interval '1 millisecond', now()
FROM (VALUES
  ('2d39e488-42b8-4354-b8ca-47852b8a60b5', '2025', 2025, '2025-01-01', '2025-12-31', '2025'),
  ('2d39e488-42b8-4354-b8ca-47852b8a60b5', '2026', 2026, '2026-01-01', '2026-12-31', '2026'),
  ('2d39e488-42b8-4354-b8ca-47852b8a60b5', '2027', 2027, '2027-01-01', '2027-12-31', '2027'),
  ('c4d2cda5-f6df-4156-8fc2-26bfb5b3352d', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('c4d2cda5-f6df-4156-8fc2-26bfb5b3352d', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('c4d2cda5-f6df-4156-8fc2-26bfb5b3352d', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('52231de6-f739-43ff-b731-d5c86776beb8', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('52231de6-f739-43ff-b731-d5c86776beb8', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('52231de6-f739-43ff-b731-d5c86776beb8', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('5eb10869-d5c2-4127-b549-037ab914d97e', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('5eb10869-d5c2-4127-b549-037ab914d97e', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('5eb10869-d5c2-4127-b549-037ab914d97e', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('b558b79e-be53-4741-a309-00be94c641ec', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('b558b79e-be53-4741-a309-00be94c641ec', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('b558b79e-be53-4741-a309-00be94c641ec', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('f8dc8a57-ebda-4d61-b78b-03f2db8ac164', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('f8dc8a57-ebda-4d61-b78b-03f2db8ac164', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('f8dc8a57-ebda-4d61-b78b-03f2db8ac164', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('ec21ed6c-3bf8-495c-867e-50d2561fddb2', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('ec21ed6c-3bf8-495c-867e-50d2561fddb2', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('ec21ed6c-3bf8-495c-867e-50d2561fddb2', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('b7bee9c9-e7b0-44be-9d9d-630a8340dcf5', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('b7bee9c9-e7b0-44be-9d9d-630a8340dcf5', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('b7bee9c9-e7b0-44be-9d9d-630a8340dcf5', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('3e2c8242-5991-4281-ad57-7a955f179fd1', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('3e2c8242-5991-4281-ad57-7a955f179fd1', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('3e2c8242-5991-4281-ad57-7a955f179fd1', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('6fa88e2c-e828-40f4-9ba1-be3302e54d18', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('6fa88e2c-e828-40f4-9ba1-be3302e54d18', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('6fa88e2c-e828-40f4-9ba1-be3302e54d18', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('89753830-f4b5-4c3e-8f30-8dac2465061b', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('89753830-f4b5-4c3e-8f30-8dac2465061b', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('89753830-f4b5-4c3e-8f30-8dac2465061b', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', '2025', 2025, '2025-03-01', '2025-11-30', '2025'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', '2026', 2026, '2026-03-01', '2026-11-30', '2026'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', '2027', 2027, '2027-03-01', '2027-11-30', '2027'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61', '2025', 2025, '2025-05-01', '2025-10-31', '2025'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61', '2026', 2026, '2026-05-01', '2026-10-31', '2026'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61', '2027', 2027, '2027-05-01', '2027-10-31', '2027'),
  ('1d4245e7-27e5-4386-bb2f-fad87ef7b8e5', '2025', 2025, '2025-02-01', '2025-12-31', NULL),
  ('1d4245e7-27e5-4386-bb2f-fad87ef7b8e5', '2026', 2026, '2026-02-01', '2026-12-31', NULL),
  ('1d4245e7-27e5-4386-bb2f-fad87ef7b8e5', '2027', 2027, '2027-02-01', '2027-12-31', NULL),
  ('831d8e9a-4eb3-4afc-b1ae-1b71d436ca18', '2025', 2025, '2025-03-01', '2025-11-30', NULL),
  ('831d8e9a-4eb3-4afc-b1ae-1b71d436ca18', '2026', 2026, '2026-03-01', '2026-11-30', NULL),
  ('831d8e9a-4eb3-4afc-b1ae-1b71d436ca18', '2027', 2027, '2027-03-01', '2027-11-30', NULL),
  ('a91d9af2-757f-4d46-845f-fbd621a2ce6d', '2025', 2025, '2025-08-01', '2025-12-31', NULL),
  ('a91d9af2-757f-4d46-845f-fbd621a2ce6d', '2026', 2026, '2026-08-01', '2026-12-31', NULL),
  ('a91d9af2-757f-4d46-845f-fbd621a2ce6d', '2027', 2027, '2027-08-01', '2027-12-31', NULL),
  ('28014434-2aa7-4950-af84-f952a7e81f42', '2025', 2025, '2025-08-01', '2025-12-31', NULL),
  ('28014434-2aa7-4950-af84-f952a7e81f42', '2026', 2026, '2026-08-01', '2026-12-31', NULL),
  ('28014434-2aa7-4950-af84-f952a7e81f42', '2027', 2027, '2027-08-01', '2027-12-31', NULL),
  ('bc8c3afb-4a18-4bbf-ae4b-79d94b795ab6', '2025', 2025, '2025-01-01', '2025-05-31', NULL),
  ('bc8c3afb-4a18-4bbf-ae4b-79d94b795ab6', '2026', 2026, '2026-01-01', '2026-05-31', NULL),
  ('bc8c3afb-4a18-4bbf-ae4b-79d94b795ab6', '2027', 2027, '2027-01-01', '2027-05-31', NULL),
  ('0ee056ee-ae8b-400d-ba8d-b88e944ff8d3', '2025', 2025, '2025-01-01', '2025-05-31', NULL),
  ('0ee056ee-ae8b-400d-ba8d-b88e944ff8d3', '2026', 2026, '2026-01-01', '2026-05-31', NULL),
  ('0ee056ee-ae8b-400d-ba8d-b88e944ff8d3', '2027', 2027, '2027-01-01', '2027-05-31', NULL),
  ('f91f2566-1978-4171-a706-ae417c4d601a', '2025', 2025, '2025-09-01', '2026-02-28', '2025'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', '2026', 2026, '2026-09-01', '2027-02-28', '2026'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', '2027', 2027, '2027-09-01', '2028-02-28', '2027'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', '2025', 2025, '2025-12-01', '2026-01-31', '2025'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', '2026', 2026, '2026-12-01', '2027-01-31', '2026'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', '2027', 2027, '2027-12-01', '2028-01-31', '2027'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', '2025-26', 2026, '2025-10-01', '2026-06-30', '2025'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', '2026-27', 2027, '2026-10-01', '2027-06-30', '2026'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', '2027-28', 2028, '2027-10-01', '2028-06-30', '2027'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', '2025-26', 2026, '2025-10-01', '2026-06-30', '2025'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', '2026-27', 2027, '2026-10-01', '2027-06-30', '2026'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', '2027-28', 2028, '2027-10-01', '2028-06-30', '2027'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', '2025-26', 2026, '2025-11-01', '2026-04-30', '2025'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', '2026-27', 2027, '2026-11-01', '2027-04-30', '2026'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', '2027-28', 2028, '2027-11-01', '2028-04-30', '2027'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', '2025-26', 2026, '2025-11-01', '2026-04-30', '2025'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', '2026-27', 2027, '2026-11-01', '2027-04-30', '2026'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', '2027-28', 2028, '2027-11-01', '2028-04-30', '2027'),
  ('991e40bf-cf2c-440e-b983-3d5d88ffa782', '2025-26', 2026, '2025-10-01', '2026-04-30', NULL),
  ('991e40bf-cf2c-440e-b983-3d5d88ffa782', '2026-27', 2027, '2026-10-01', '2027-04-30', NULL),
  ('991e40bf-cf2c-440e-b983-3d5d88ffa782', '2027-28', 2028, '2027-10-01', '2028-04-30', NULL),
  ('b195b4bc-9275-49fa-9442-5c2c651ca317', '2025-26', 2026, '2025-10-01', '2026-04-30', NULL),
  ('b195b4bc-9275-49fa-9442-5c2c651ca317', '2026-27', 2027, '2026-10-01', '2027-04-30', NULL),
  ('b195b4bc-9275-49fa-9442-5c2c651ca317', '2027-28', 2028, '2027-10-01', '2028-04-30', NULL),
  ('93c2508a-a52e-4d1d-beee-796bc14c9fe2', '2025-26', 2026, '2025-08-01', '2026-05-31', '2025'),
  ('93c2508a-a52e-4d1d-beee-796bc14c9fe2', '2026-27', 2027, '2026-08-01', '2027-05-31', '2026'),
  ('93c2508a-a52e-4d1d-beee-796bc14c9fe2', '2027-28', 2028, '2027-08-01', '2028-05-31', '2027'),
  ('5e1930aa-989b-4b92-85f0-a3d604f4a546', '2025-26', 2026, '2025-09-01', '2026-06-15', NULL),
  ('5e1930aa-989b-4b92-85f0-a3d604f4a546', '2026-27', 2027, '2026-09-01', '2027-06-15', NULL),
  ('5e1930aa-989b-4b92-85f0-a3d604f4a546', '2027-28', 2028, '2027-09-01', '2028-06-15', NULL),
  ('b9dc046c-93de-4b7e-8e3a-659455b46d6b', '2025-26', 2026, '2025-11-01', '2026-05-31', NULL),
  ('b9dc046c-93de-4b7e-8e3a-659455b46d6b', '2026-27', 2027, '2026-11-01', '2027-05-31', NULL),
  ('b9dc046c-93de-4b7e-8e3a-659455b46d6b', '2027-28', 2028, '2027-11-01', '2028-05-31', NULL),
  ('1015d5a8-22d1-482d-ba6a-d41c672e32b8', '2022', 2022, '2022-11-20', '2022-12-18', '2022'),
  ('1015d5a8-22d1-482d-ba6a-d41c672e32b8', '2026', 2026, '2026-06-11', '2026-07-19', '2026'),
  ('1015d5a8-22d1-482d-ba6a-d41c672e32b8', '2030', 2030, '2030-06-01', '2030-07-31', '2030'),
  ('6e593fe5-2c26-4992-9631-c5a832c1e001', '2023', 2023, '2023-07-20', '2023-08-20', NULL),
  ('6e593fe5-2c26-4992-9631-c5a832c1e001', '2027', 2027, '2027-06-24', '2027-07-25', NULL),
  ('acba33f8-d08b-40e9-9686-54263d3622ec', '2024', 2024, '2024-06-20', '2024-07-14', NULL),
  ('acba33f8-d08b-40e9-9686-54263d3622ec', '2028', 2028, '2028-06-01', '2028-07-31', NULL),
  ('f8f6171f-64af-4ab6-81cf-0c81973ed459', '2024', 2024, '2024-06-14', '2024-07-14', NULL),
  ('f8f6171f-64af-4ab6-81cf-0c81973ed459', '2028', 2028, '2028-06-01', '2028-07-31', NULL)
) AS s(league, name, year, starts, ends, provider_season)
JOIN "sport_leagues" sl ON sl."id" = s.league::uuid;

INSERT INTO "sport_league_season_provider_mappings" ("sport_league_id", "sport_league_season_id", "sport_league_provider_mapping_id", "provider_season_id", "updated_at")
SELECT se."sport_league_id", se."id", m."id", s.provider_season, now()
FROM (VALUES
  ('2d39e488-42b8-4354-b8ca-47852b8a60b5', '2025', 2025, '2025-01-01', '2025-12-31', '2025'),
  ('2d39e488-42b8-4354-b8ca-47852b8a60b5', '2026', 2026, '2026-01-01', '2026-12-31', '2026'),
  ('2d39e488-42b8-4354-b8ca-47852b8a60b5', '2027', 2027, '2027-01-01', '2027-12-31', '2027'),
  ('c4d2cda5-f6df-4156-8fc2-26bfb5b3352d', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('c4d2cda5-f6df-4156-8fc2-26bfb5b3352d', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('c4d2cda5-f6df-4156-8fc2-26bfb5b3352d', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('52231de6-f739-43ff-b731-d5c86776beb8', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('52231de6-f739-43ff-b731-d5c86776beb8', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('52231de6-f739-43ff-b731-d5c86776beb8', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('5eb10869-d5c2-4127-b549-037ab914d97e', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('5eb10869-d5c2-4127-b549-037ab914d97e', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('5eb10869-d5c2-4127-b549-037ab914d97e', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('b558b79e-be53-4741-a309-00be94c641ec', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('b558b79e-be53-4741-a309-00be94c641ec', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('b558b79e-be53-4741-a309-00be94c641ec', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('f8dc8a57-ebda-4d61-b78b-03f2db8ac164', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('f8dc8a57-ebda-4d61-b78b-03f2db8ac164', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('f8dc8a57-ebda-4d61-b78b-03f2db8ac164', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('ec21ed6c-3bf8-495c-867e-50d2561fddb2', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('ec21ed6c-3bf8-495c-867e-50d2561fddb2', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('ec21ed6c-3bf8-495c-867e-50d2561fddb2', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('b7bee9c9-e7b0-44be-9d9d-630a8340dcf5', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('b7bee9c9-e7b0-44be-9d9d-630a8340dcf5', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('b7bee9c9-e7b0-44be-9d9d-630a8340dcf5', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('3e2c8242-5991-4281-ad57-7a955f179fd1', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('3e2c8242-5991-4281-ad57-7a955f179fd1', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('3e2c8242-5991-4281-ad57-7a955f179fd1', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('6fa88e2c-e828-40f4-9ba1-be3302e54d18', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('6fa88e2c-e828-40f4-9ba1-be3302e54d18', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('6fa88e2c-e828-40f4-9ba1-be3302e54d18', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('89753830-f4b5-4c3e-8f30-8dac2465061b', '2025', 2025, '2025-01-01', '2025-12-31', NULL),
  ('89753830-f4b5-4c3e-8f30-8dac2465061b', '2026', 2026, '2026-01-01', '2026-12-31', NULL),
  ('89753830-f4b5-4c3e-8f30-8dac2465061b', '2027', 2027, '2027-01-01', '2027-12-31', NULL),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', '2025', 2025, '2025-03-01', '2025-11-30', '2025'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', '2026', 2026, '2026-03-01', '2026-11-30', '2026'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', '2027', 2027, '2027-03-01', '2027-11-30', '2027'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61', '2025', 2025, '2025-05-01', '2025-10-31', '2025'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61', '2026', 2026, '2026-05-01', '2026-10-31', '2026'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61', '2027', 2027, '2027-05-01', '2027-10-31', '2027'),
  ('1d4245e7-27e5-4386-bb2f-fad87ef7b8e5', '2025', 2025, '2025-02-01', '2025-12-31', NULL),
  ('1d4245e7-27e5-4386-bb2f-fad87ef7b8e5', '2026', 2026, '2026-02-01', '2026-12-31', NULL),
  ('1d4245e7-27e5-4386-bb2f-fad87ef7b8e5', '2027', 2027, '2027-02-01', '2027-12-31', NULL),
  ('831d8e9a-4eb3-4afc-b1ae-1b71d436ca18', '2025', 2025, '2025-03-01', '2025-11-30', NULL),
  ('831d8e9a-4eb3-4afc-b1ae-1b71d436ca18', '2026', 2026, '2026-03-01', '2026-11-30', NULL),
  ('831d8e9a-4eb3-4afc-b1ae-1b71d436ca18', '2027', 2027, '2027-03-01', '2027-11-30', NULL),
  ('a91d9af2-757f-4d46-845f-fbd621a2ce6d', '2025', 2025, '2025-08-01', '2025-12-31', NULL),
  ('a91d9af2-757f-4d46-845f-fbd621a2ce6d', '2026', 2026, '2026-08-01', '2026-12-31', NULL),
  ('a91d9af2-757f-4d46-845f-fbd621a2ce6d', '2027', 2027, '2027-08-01', '2027-12-31', NULL),
  ('28014434-2aa7-4950-af84-f952a7e81f42', '2025', 2025, '2025-08-01', '2025-12-31', NULL),
  ('28014434-2aa7-4950-af84-f952a7e81f42', '2026', 2026, '2026-08-01', '2026-12-31', NULL),
  ('28014434-2aa7-4950-af84-f952a7e81f42', '2027', 2027, '2027-08-01', '2027-12-31', NULL),
  ('bc8c3afb-4a18-4bbf-ae4b-79d94b795ab6', '2025', 2025, '2025-01-01', '2025-05-31', NULL),
  ('bc8c3afb-4a18-4bbf-ae4b-79d94b795ab6', '2026', 2026, '2026-01-01', '2026-05-31', NULL),
  ('bc8c3afb-4a18-4bbf-ae4b-79d94b795ab6', '2027', 2027, '2027-01-01', '2027-05-31', NULL),
  ('0ee056ee-ae8b-400d-ba8d-b88e944ff8d3', '2025', 2025, '2025-01-01', '2025-05-31', NULL),
  ('0ee056ee-ae8b-400d-ba8d-b88e944ff8d3', '2026', 2026, '2026-01-01', '2026-05-31', NULL),
  ('0ee056ee-ae8b-400d-ba8d-b88e944ff8d3', '2027', 2027, '2027-01-01', '2027-05-31', NULL),
  ('f91f2566-1978-4171-a706-ae417c4d601a', '2025', 2025, '2025-09-01', '2026-02-28', '2025'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', '2026', 2026, '2026-09-01', '2027-02-28', '2026'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', '2027', 2027, '2027-09-01', '2028-02-28', '2027'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', '2025', 2025, '2025-12-01', '2026-01-31', '2025'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', '2026', 2026, '2026-12-01', '2027-01-31', '2026'),
  ('37b259d2-b681-4ca5-94d4-894d5e9bcc10', '2027', 2027, '2027-12-01', '2028-01-31', '2027'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', '2025-26', 2026, '2025-10-01', '2026-06-30', '2025'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', '2026-27', 2027, '2026-10-01', '2027-06-30', '2026'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', '2027-28', 2028, '2027-10-01', '2028-06-30', '2027'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', '2025-26', 2026, '2025-10-01', '2026-06-30', '2025'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', '2026-27', 2027, '2026-10-01', '2027-06-30', '2026'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', '2027-28', 2028, '2027-10-01', '2028-06-30', '2027'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', '2025-26', 2026, '2025-11-01', '2026-04-30', '2025'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', '2026-27', 2027, '2026-11-01', '2027-04-30', '2026'),
  ('4d18eb42-0049-425e-a8f2-2122324123fc', '2027-28', 2028, '2027-11-01', '2028-04-30', '2027'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', '2025-26', 2026, '2025-11-01', '2026-04-30', '2025'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', '2026-27', 2027, '2026-11-01', '2027-04-30', '2026'),
  ('ec248e1f-4468-4ecf-a9cf-51e02eebbf46', '2027-28', 2028, '2027-11-01', '2028-04-30', '2027'),
  ('991e40bf-cf2c-440e-b983-3d5d88ffa782', '2025-26', 2026, '2025-10-01', '2026-04-30', NULL),
  ('991e40bf-cf2c-440e-b983-3d5d88ffa782', '2026-27', 2027, '2026-10-01', '2027-04-30', NULL),
  ('991e40bf-cf2c-440e-b983-3d5d88ffa782', '2027-28', 2028, '2027-10-01', '2028-04-30', NULL),
  ('b195b4bc-9275-49fa-9442-5c2c651ca317', '2025-26', 2026, '2025-10-01', '2026-04-30', NULL),
  ('b195b4bc-9275-49fa-9442-5c2c651ca317', '2026-27', 2027, '2026-10-01', '2027-04-30', NULL),
  ('b195b4bc-9275-49fa-9442-5c2c651ca317', '2027-28', 2028, '2027-10-01', '2028-04-30', NULL),
  ('93c2508a-a52e-4d1d-beee-796bc14c9fe2', '2025-26', 2026, '2025-08-01', '2026-05-31', '2025'),
  ('93c2508a-a52e-4d1d-beee-796bc14c9fe2', '2026-27', 2027, '2026-08-01', '2027-05-31', '2026'),
  ('93c2508a-a52e-4d1d-beee-796bc14c9fe2', '2027-28', 2028, '2027-08-01', '2028-05-31', '2027'),
  ('5e1930aa-989b-4b92-85f0-a3d604f4a546', '2025-26', 2026, '2025-09-01', '2026-06-15', NULL),
  ('5e1930aa-989b-4b92-85f0-a3d604f4a546', '2026-27', 2027, '2026-09-01', '2027-06-15', NULL),
  ('5e1930aa-989b-4b92-85f0-a3d604f4a546', '2027-28', 2028, '2027-09-01', '2028-06-15', NULL),
  ('b9dc046c-93de-4b7e-8e3a-659455b46d6b', '2025-26', 2026, '2025-11-01', '2026-05-31', NULL),
  ('b9dc046c-93de-4b7e-8e3a-659455b46d6b', '2026-27', 2027, '2026-11-01', '2027-05-31', NULL),
  ('b9dc046c-93de-4b7e-8e3a-659455b46d6b', '2027-28', 2028, '2027-11-01', '2028-05-31', NULL),
  ('1015d5a8-22d1-482d-ba6a-d41c672e32b8', '2022', 2022, '2022-11-20', '2022-12-18', '2022'),
  ('1015d5a8-22d1-482d-ba6a-d41c672e32b8', '2026', 2026, '2026-06-11', '2026-07-19', '2026'),
  ('1015d5a8-22d1-482d-ba6a-d41c672e32b8', '2030', 2030, '2030-06-01', '2030-07-31', '2030'),
  ('6e593fe5-2c26-4992-9631-c5a832c1e001', '2023', 2023, '2023-07-20', '2023-08-20', NULL),
  ('6e593fe5-2c26-4992-9631-c5a832c1e001', '2027', 2027, '2027-06-24', '2027-07-25', NULL),
  ('acba33f8-d08b-40e9-9686-54263d3622ec', '2024', 2024, '2024-06-20', '2024-07-14', NULL),
  ('acba33f8-d08b-40e9-9686-54263d3622ec', '2028', 2028, '2028-06-01', '2028-07-31', NULL),
  ('f8f6171f-64af-4ab6-81cf-0c81973ed459', '2024', 2024, '2024-06-14', '2024-07-14', NULL),
  ('f8f6171f-64af-4ab6-81cf-0c81973ed459', '2028', 2028, '2028-06-01', '2028-07-31', NULL)
) AS s(league, name, year, starts, ends, provider_season)
JOIN "sport_league_seasons" se ON se."sport_league_id" = s.league::uuid AND se."championship_year" = s.year
-- These ids are BALLDONTLIE's, so only a mapping to one of its leagues takes them.
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = se."sport_league_id"
JOIN "provider_leagues" pl ON pl."id" = m."provider_league_id" AND pl."provider_id" = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11'
WHERE s.provider_season IS NOT NULL;

-- A league with events but no Season above (one a test database made) gets a Season for each
-- event year it has, dated by those events, so every event has a Season to move to.
INSERT INTO "sport_league_seasons" ("sport_league_id", "name", "championship_year", "starts_at", "ends_at", "updated_at")
SELECT es."sport_league_id", e."event_year"::text, e."event_year", min(e."start_date"),
  greatest(max(coalesce(e."end_date", e."start_date")), min(e."start_date") + interval '1 day'), now()
FROM "sport_events" e
JOIN "event_series" es ON es."id" = e."event_series_id"
WHERE NOT EXISTS (SELECT 1 FROM "sport_league_seasons" x WHERE x."sport_league_id" = es."sport_league_id")
GROUP BY es."sport_league_id", e."event_year";

-- Every phase in every Season; a slot for each definition of a synced phase but a tournament.
INSERT INTO "sport_league_season_phases" ("sport_league_id", "sport_league_season_id", "sport_league_phase_id", "updated_at")
SELECT se."sport_league_id", se."id", p."id", now()
FROM "sport_league_seasons" se
JOIN "sport_league_phases" p ON p."sport_league_id" = se."sport_league_id";

INSERT INTO "sport_league_season_phase_slots" ("sport_league_id", "sport_league_season_id", "sport_league_season_phase_id", "sport_league_phase_slot_id", "series_format", "series_games", "pairing", "updated_at")
SELECT sp."sport_league_id", sp."sport_league_season_id", sp."id", d."id", d."series_format", d."series_games", d."pairing", now()
FROM "sport_league_season_phases" sp
JOIN "sport_league_phases" p ON p."id" = sp."sport_league_phase_id" AND p."is_synced"
JOIN "sport_league_phase_slots" d ON d."sport_league_phase_id" = p."id" AND d."slot_kind" <> 'TOURNAMENT';

-- Events move onto their league's Season: the one whose span holds the event's start, else the
-- one named for its event year, else the nearest.
ALTER TABLE "sport_events" ADD COLUMN "sport_league_season_id" UUID;
UPDATE "sport_events" e SET "sport_league_season_id" = (
  SELECT se."id"
  FROM "event_series" es
  JOIN "sport_league_seasons" se ON se."sport_league_id" = es."sport_league_id"
  WHERE es."id" = e."event_series_id"
  ORDER BY (e."start_date" BETWEEN se."starts_at" AND se."ends_at") DESC,
    (se."championship_year" = e."event_year") DESC,
    least(abs(extract(epoch FROM e."start_date" - se."starts_at")), abs(extract(epoch FROM e."start_date" - se."ends_at"))),
    se."starts_at"
  LIMIT 1
);
DROP INDEX "sport_events_event_series_id_event_year_key";
DROP INDEX "sport_events_event_year_idx";
ALTER TABLE "sport_events" DROP COLUMN "event_year";
ALTER TABLE "sport_events" ALTER COLUMN "sport_league_season_id" SET NOT NULL;
CREATE INDEX "sport_events_sport_league_season_id_idx" ON "sport_events"("sport_league_season_id");
CREATE UNIQUE INDEX "sport_events_event_series_id_sport_league_season_id_key" ON "sport_events"("event_series_id", "sport_league_season_id");
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_sport_league_season_id_fkey" FOREIGN KEY ("sport_league_season_id") REFERENCES "sport_league_seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The current Season replaces the hand-set current year, by the rule the daily recompute uses
-- (`currentSeasonOf`): the Season whose span holds now; between Seasons the next one once it has
-- a synced event, otherwise the last one; a league with only later Seasons takes the first.
ALTER TABLE "sport_leagues" DROP COLUMN "current_event_year";
ALTER TABLE "sport_leagues" ADD COLUMN "current_season_id" UUID;
UPDATE "sport_leagues" sl SET "current_season_id" = (
  SELECT se."id"
  FROM "sport_league_seasons" se
  WHERE se."sport_league_id" = sl."id"
  ORDER BY
    (now() BETWEEN se."starts_at" AND se."ends_at") DESC,
    -- Only the earliest Season still to start counts, as in `currentSeasonOf`.
    (se."starts_at" > now() AND NOT EXISTS (
      SELECT 1 FROM "sport_league_seasons" earlier
      WHERE earlier."sport_league_id" = se."sport_league_id" AND earlier."starts_at" > now() AND earlier."starts_at" < se."starts_at"
    ) AND EXISTS (
      SELECT 1 FROM "sport_events" e WHERE e."sport_league_season_id" = se."id" AND e."sync_scope" <> 'NONE'
    )) DESC,
    (se."ends_at" < now()) DESC,
    CASE WHEN se."ends_at" < now() THEN -extract(epoch FROM se."ends_at") ELSE extract(epoch FROM se."starts_at") END
  LIMIT 1
);
CREATE UNIQUE INDEX "sport_leagues_id_current_season_id_key" ON "sport_leagues"("id", "current_season_id");
ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_current_season_fkey" FOREIGN KEY ("id", "current_season_id") REFERENCES "sport_league_seasons"("sport_league_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
