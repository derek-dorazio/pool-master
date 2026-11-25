-- League model slice 11 (#2010, plan §7 and §9c): EventSeries is removed. A contest template lists
-- the slot definitions it covers (contest_config_template_slots) with a coverage mode, an event
-- page offer names the slot definition its edition is read from, and an event names its own sport
-- league, with its Season held to that league by a composite key. The four multi-tournament field
-- pools are deleted with their contests (ADR 0014). One-way: the series names are not kept.

-- CreateEnum
CREATE TYPE "PrismaTemplateCoverageMode" AS ENUM ('ONE_SLOT', 'ALL_LISTED', 'FROM_SLOT');

-- The multi-tournament field pools (ADR 0014), their contests and their offers. A league runs one
-- contest per major instead, and its Majors or Grand Slam Cup adds them up.
CREATE TEMPORARY TABLE "retired_templates" ON COMMIT DROP AS
SELECT "id" FROM "contest_config_templates"
WHERE "template_key" IN ('pga-tour-majors-tiered', 'lpga-tour-majors-tiered', 'atp-slams-tiered-doubling', 'wta-slams-tiered-doubling');

CREATE TEMPORARY TABLE "retired_contests" ON COMMIT DROP AS
SELECT c."contest_id" AS "id" FROM "contest_configurations" c WHERE c."template_id" IN (SELECT "id" FROM "retired_templates");

UPDATE "email_messages" SET "entry_id" = NULL
WHERE "entry_id" IN (SELECT "id" FROM "contest_entries" WHERE "contest_id" IN (SELECT "id" FROM "retired_contests"));
UPDATE "email_messages" SET "contest_id" = NULL WHERE "contest_id" IN (SELECT "id" FROM "retired_contests");
UPDATE "league_payments" SET "contest_id" = NULL WHERE "contest_id" IN (SELECT "id" FROM "retired_contests");
DELETE FROM "contest_squares_winners" WHERE "contest_id" IN (SELECT "id" FROM "retired_contests");
DELETE FROM "contest_entry_picks"
WHERE "entry_id" IN (SELECT "id" FROM "contest_entries" WHERE "contest_id" IN (SELECT "id" FROM "retired_contests"));
DELETE FROM "contest_entries" WHERE "contest_id" IN (SELECT "id" FROM "retired_contests");
DELETE FROM "participant_contest_scoring_rules"
WHERE "contest_configuration_id" IN (SELECT "id" FROM "contest_configurations" WHERE "contest_id" IN (SELECT "id" FROM "retired_contests"));
DELETE FROM "contest_configurations" WHERE "contest_id" IN (SELECT "id" FROM "retired_contests");
DELETE FROM "contests" WHERE "id" IN (SELECT "id" FROM "retired_contests");
DELETE FROM "event_page_offers" WHERE "template_id" IN (SELECT "id" FROM "retired_templates");
DELETE FROM "contest_config_templates" WHERE "id" IN (SELECT "id" FROM "retired_templates");

-- CreateTable
CREATE TABLE "contest_config_template_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "sport_league_phase_slot_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_config_template_slots_pkey" PRIMARY KEY ("id")
);

-- Each template's slots, from the facts its event type stood for, never from a name:
--   a KNOCKOUT template covers its league's knockout slots: every POSTSEASON slot but the play-in
--   and TOURNAMENT slots (whole-tournament templates leave the play-in out), or, for a league
--   whose events are TOURNAMENT slots played head to head, each such tournament;
--   a WEEK template covers the league's WEEK slots;
--   a template for every event covers the league's TOURNAMENT slots, or for squares every slot.
-- A squares template keeps only the squares-eligible slots.
INSERT INTO "contest_config_template_slots" ("sport_league_id", "template_id", "sport_league_phase_slot_id")
SELECT t."sport_league_id", t."id", d."id"
FROM "contest_config_templates" t
JOIN "sport_league_phase_slots" d ON d."sport_league_id" = t."sport_league_id"
JOIN "sport_league_phases" p ON p."id" = d."sport_league_phase_id"
WHERE (t."selection_type" <> 'SQUARES' OR d."squares_eligible")
  AND CASE
    WHEN t."event_type" = 'KNOCKOUT' THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM "sport_league_phase_slots" k
        WHERE k."sport_league_id" = t."sport_league_id" AND k."slot_kind" = 'TOURNAMENT' AND k."match_format" = 'HEAD_TO_HEAD'
      )
      THEN d."slot_kind" = 'TOURNAMENT' AND d."match_format" = 'HEAD_TO_HEAD'
      ELSE p."phase" = 'POSTSEASON' AND d."slot_kind" NOT IN ('PLAY_IN', 'TOURNAMENT')
      END
    WHEN t."event_type" = 'WEEK' THEN d."slot_kind" = 'WEEK'
    WHEN t."selection_type" = 'SQUARES' THEN TRUE
    ELSE d."slot_kind" = 'TOURNAMENT'
  END;

-- AlterTable: the coverage mode. A survivor runs from a starting slot on; a pick'em, squares, a
-- template on TOURNAMENT slots (each its own event) and a template on WEEK slots take one slot; the
-- rest of a knockout's templates cover every listed slot of the one event.
ALTER TABLE "contest_config_templates" ADD COLUMN "coverage_mode" "PrismaTemplateCoverageMode";
UPDATE "contest_config_templates" t SET "coverage_mode" = (CASE
  WHEN t."selection_type" = 'SURVIVOR' THEN 'FROM_SLOT'
  WHEN t."selection_type" IN ('PICK_EM', 'SQUARES') THEN 'ONE_SLOT'
  WHEN EXISTS (
    SELECT 1 FROM "contest_config_template_slots" ts JOIN "sport_league_phase_slots" d ON d."id" = ts."sport_league_phase_slot_id"
    WHERE ts."template_id" = t."id" AND d."slot_kind" IN ('TOURNAMENT', 'WEEK')
  ) THEN 'ONE_SLOT'
  WHEN t."event_type" = 'KNOCKOUT' THEN 'ALL_LISTED'
  ELSE 'ONE_SLOT'
END)::"PrismaTemplateCoverageMode";
ALTER TABLE "contest_config_templates" ALTER COLUMN "coverage_mode" SET NOT NULL;

-- One default per (sport league, selection type): the NFL's season-long survivor stays the
-- default, and its playoff survivor, the default for the old KNOCKOUT event type, stops being one.
UPDATE "contest_config_templates" t SET "is_default" = FALSE
WHERE t."is_default" AND t."event_type" = 'KNOCKOUT' AND EXISTS (
  SELECT 1 FROM "contest_config_templates" o
  WHERE o."sport_league_id" = t."sport_league_id" AND o."selection_type" = t."selection_type"
    AND o."id" <> t."id" AND o."is_default" AND o."event_type" IS DISTINCT FROM 'KNOCKOUT'
);

-- DropIndex
DROP INDEX "contest_config_templates_sport_league_id_event_type_contest_key";

-- AlterTable
ALTER TABLE "contest_config_templates" DROP COLUMN "event_series_names",
DROP COLUMN "event_type";

-- DropEnum
DROP TYPE "PrismaContestTemplateEventType";

-- CreateIndex
CREATE UNIQUE INDEX "contest_config_templates_sport_league_id_template_key_key" ON "contest_config_templates"("sport_league_id", "template_key");

-- CreateIndex
CREATE UNIQUE INDEX "contest_config_templates_sport_league_id_id_key" ON "contest_config_templates"("sport_league_id", "id");

-- One default per sport league and selection type (#2010), which Prisma cannot declare.
CREATE UNIQUE INDEX "contest_config_templates_one_default" ON "contest_config_templates"("sport_league_id", "selection_type") WHERE "is_default";

-- CreateIndex
CREATE INDEX "contest_config_template_slots_sport_league_id_sport_league__idx" ON "contest_config_template_slots"("sport_league_id", "sport_league_phase_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_config_template_slots_template_id_sport_league_phas_key" ON "contest_config_template_slots"("template_id", "sport_league_phase_slot_id");

-- AddForeignKey
ALTER TABLE "contest_config_template_slots" ADD CONSTRAINT "contest_config_template_slots_template_fkey" FOREIGN KEY ("sport_league_id", "template_id") REFERENCES "contest_config_templates"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_config_template_slots" ADD CONSTRAINT "contest_config_template_slots_definition_fkey" FOREIGN KEY ("sport_league_id", "sport_league_phase_slot_id") REFERENCES "sport_league_phase_slots"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Event page offers name the slot definition their edition is read from. The one seeded page,
-- Championship Weekend, shows the NFL's conference championships (the bracket starts there): its
-- offers take the league's SEMIFINAL definition, by its key.
ALTER TABLE "event_page_offers" ADD COLUMN "sport_league_phase_slot_id" UUID;
UPDATE "event_page_offers" o SET "sport_league_phase_slot_id" = d."id"
FROM "event_pages" p, "sport_league_phase_slots" d
WHERE p."id" = o."event_page_id" AND p."url_segment" = 'championship-weekend'
  AND d."sport_league_id" = o."sport_league_id" AND d."key" = 'SEMIFINAL';
-- An offer no definition was found for has no edition to show.
DELETE FROM "event_page_offers" WHERE "sport_league_phase_slot_id" IS NULL;
ALTER TABLE "event_page_offers" ALTER COLUMN "sport_league_phase_slot_id" SET NOT NULL;
ALTER TABLE "event_page_offers" DROP COLUMN "event_series_name";

-- DropIndex
DROP INDEX "event_page_offers_sport_league_id_idx";

-- CreateIndex
CREATE INDEX "event_page_offers_sport_league_id_sport_league_phase_slot_i_idx" ON "event_page_offers"("sport_league_id", "sport_league_phase_slot_id");

-- AddForeignKey
ALTER TABLE "event_page_offers" ADD CONSTRAINT "event_page_offers_definition_fkey" FOREIGN KEY ("sport_league_id", "sport_league_phase_slot_id") REFERENCES "sport_league_phase_slots"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An event names its own sport league, read from its series before the series go.
ALTER TABLE "sport_events" ADD COLUMN "sport_league_id" UUID;
UPDATE "sport_events" e SET "sport_league_id" = s."sport_league_id" FROM "event_series" s WHERE s."id" = e."event_series_id";
ALTER TABLE "sport_events" ALTER COLUMN "sport_league_id" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "sport_events" DROP CONSTRAINT "sport_events_event_series_id_fkey";

-- DropForeignKey
ALTER TABLE "sport_events" DROP CONSTRAINT "sport_events_sport_league_season_id_fkey";

-- DropIndex
DROP INDEX "sport_events_event_series_id_sport_league_season_id_key";

-- AlterTable
ALTER TABLE "sport_events" DROP COLUMN "event_series_id";

-- CreateIndex
CREATE INDEX "sport_events_sport_league_id_sport_league_season_id_idx" ON "sport_events"("sport_league_id", "sport_league_season_id");

-- AddForeignKey
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: the event's Season is one of its own league's (from the #2097 review).
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_season_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_id") REFERENCES "sport_league_seasons"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DropTable
DROP TABLE "event_series";

-- The released-edition job goes (#2010): coverage is fixed when a contest is made (ADR 0014), so
-- nothing adds an edition to a contest later. Its queued and finished jobs go with the value.
DELETE FROM "background_jobs" WHERE "type" = 'ADD_RELEASED_EDITION_TO_CONTEST';
CREATE TYPE "PrismaBackgroundJobType_new" AS ENUM ('MANUAL_EVENT_SYNC', 'CONTEST_STARTED_EMAILS', 'CONTEST_SETTLED_EMAILS', 'CONTEST_EVENT_CHANGED_EMAILS', 'SETTLE_SPORT_EVENT_CONTESTS', 'SETTLE_GAME_CONTESTS', 'REBUILD_LEADERBOARDS', 'PROVIDER_EVENT_SYNC', 'CONTEST_REOPENED_EMAILS', 'SYNC_LEAGUE_EVENTS', 'RELEASE_SPORT_EVENT', 'SYNC_EVENT_GAMES_AND_TIERS', 'ACTIVATE_EVENT_CONTESTS', 'FOLLOW_POSTPONED_EVENT_CONTESTS', 'RESOLVE_MAPPED_PARTICIPANT_FINDINGS');
ALTER TABLE "background_jobs" ALTER COLUMN "type" TYPE "PrismaBackgroundJobType_new" USING ("type"::text::"PrismaBackgroundJobType_new");
ALTER TYPE "PrismaBackgroundJobType" RENAME TO "PrismaBackgroundJobType_old";
ALTER TYPE "PrismaBackgroundJobType_new" RENAME TO "PrismaBackgroundJobType";
DROP TYPE "PrismaBackgroundJobType_old";
