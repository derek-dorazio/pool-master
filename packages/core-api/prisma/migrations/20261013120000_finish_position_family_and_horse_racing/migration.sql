-- #622 and #623: the finish-position scoring family and the horse racing sport.
--
-- HORSE_RACING joins the sport enum and RACE the tournament format: a race is one field and one
-- finishing order, which neither stroke play's format nor its validity row describes. The new
-- values are only added here, never used, so ALTER TYPE ... ADD VALUE is safe inside this
-- migration's transaction; the horse racing reference row and its contest templates, which use
-- them, are the next migration.
--
-- The family's extension tables sit beside the cross-sport core, one set per family, never per
-- sport (auto racing, cycling and running will share them):
--   sport_event_participant_race_results  1:1 with a field row: how one runner's race ended
--   contest_entry_race_standings          1:1 with a settled entry standing: its points total

CREATE TYPE "RaceResultStatus" AS ENUM ('FINISHED', 'DID_NOT_FINISH', 'DISQUALIFIED', 'DID_NOT_START');

ALTER TYPE "PrismaSport" ADD VALUE 'HORSE_RACING';

ALTER TYPE "PrismaTournamentFormat" ADD VALUE 'RACE';

CREATE TABLE "contest_entry_race_standings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_entry_standing_id" UUID NOT NULL,
    "total_points" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_race_standings_pkey" PRIMARY KEY ("id")
);

-- A runner's finishing place, post position, how the race ended, whether the result is official,
-- and the jockey for this start. The admin's finishing order writes every value exactly as sent.
CREATE TABLE "sport_event_participant_race_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_participant_id" UUID NOT NULL,
    "finish_position" INTEGER,
    "start_position" INTEGER,
    "result_status" "RaceResultStatus" NOT NULL,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "rider_name" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_race_results_pkey" PRIMARY KEY ("id"),
    -- Places and post positions count from 1.
    CONSTRAINT "race_results_finish_position_positive" CHECK ("finish_position" IS NULL OR "finish_position" >= 1),
    CONSTRAINT "race_results_start_position_positive" CHECK ("start_position" IS NULL OR "start_position" >= 1),
    -- Only a finisher has a finishing place: a non-finisher scores the "did not finish" points.
    CONSTRAINT "race_results_place_only_when_finished" CHECK ("finish_position" IS NULL OR "result_status" = 'FINISHED'),
    -- An official finisher has a place; nothing official is left for the server to fill in.
    CONSTRAINT "race_results_official_finisher_has_place" CHECK (NOT "is_official" OR "result_status" <> 'FINISHED' OR "finish_position" IS NOT NULL)
);

CREATE UNIQUE INDEX "contest_entry_race_standings_contest_entry_standing_id_key" ON "contest_entry_race_standings"("contest_entry_standing_id");

CREATE UNIQUE INDEX "sport_event_participant_race_results_sport_event_participan_key" ON "sport_event_participant_race_results"("sport_event_participant_id");

ALTER TABLE "contest_entry_race_standings" ADD CONSTRAINT "contest_entry_race_standings_contest_entry_standing_id_fkey" FOREIGN KEY ("contest_entry_standing_id") REFERENCES "contest_entry_standings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A result belongs to its field row: removing the runner from the field removes its result.
ALTER TABLE "sport_event_participant_race_results" ADD CONSTRAINT "sport_event_participant_race_results_sport_event_participa_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
