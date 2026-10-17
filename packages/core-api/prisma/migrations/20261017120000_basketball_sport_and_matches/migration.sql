-- #698: the basketball sport, the knockout bracket format, and matches.
--
-- BASKETBALL joins the sport enum and KNOCKOUT_BRACKET the tournament format. The new values are
-- only added here, never used, so ALTER TYPE ... ADD VALUE is safe inside this migration's
-- transaction; the basketball reference row and its sport leagues, which use them, are the next
-- migration.
--
-- sport_event_matches is core event data beside the round schedule: one game of one round, two
-- sides (field rows, null until decided), a status, a result, and in a bracket the slot its winner
-- moves on to. One table for every head-to-head sport, never one per sport.

CREATE TYPE "PrismaMatchStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TYPE "PrismaMatchSide" AS ENUM ('HOME', 'AWAY');

ALTER TYPE "PrismaSport" ADD VALUE 'BASKETBALL';

ALTER TYPE "PrismaTournamentFormat" ADD VALUE 'KNOCKOUT_BRACKET';

-- #698 (design Q3.14): nothing ever read the flag to change a score. Survivor pools bring their
-- own typed rule when they are built.
ALTER TABLE "contests" DROP COLUMN "scoring_stops_on_elimination";

CREATE TABLE "sport_event_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "sport_event_round_id" UUID NOT NULL,
    "match_number" INTEGER NOT NULL,
    "home_sport_event_participant_id" UUID,
    "away_sport_event_participant_id" UUID,
    "is_neutral_site" BOOLEAN NOT NULL,
    "scheduled_date" TIMESTAMPTZ,
    "status" "PrismaMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "winner_side" "PrismaMatchSide",
    "home_score" INTEGER,
    "away_score" INTEGER,
    "advances_to_match_id" UUID,
    "advances_to_side" "PrismaMatchSide",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_matches_pkey" PRIMARY KEY ("id"),
    -- Match numbers count from 1, and a score is never negative (a series counts games won).
    CONSTRAINT "sport_event_matches_match_number_positive" CHECK ("match_number" >= 1),
    CONSTRAINT "sport_event_matches_scores_not_negative" CHECK (("home_score" IS NULL OR "home_score" >= 0) AND ("away_score" IS NULL OR "away_score" >= 0)),
    -- A team cannot play itself.
    CONSTRAINT "sport_event_matches_sides_differ" CHECK ("home_sport_event_participant_id" IS NULL OR "away_sport_event_participant_id" IS NULL OR "home_sport_event_participant_id" <> "away_sport_event_participant_id"),
    -- Where the winner goes names both the match and the side, or neither (the final).
    CONSTRAINT "sport_event_matches_advances_to_side_with_match" CHECK (("advances_to_match_id" IS NULL) = ("advances_to_side" IS NULL)),
    -- A winner only once the match is over; a winner never advances into its own match.
    CONSTRAINT "sport_event_matches_winner_only_when_completed" CHECK ("winner_side" IS NULL OR "status" = 'COMPLETED'),
    CONSTRAINT "sport_event_matches_advances_elsewhere" CHECK ("advances_to_match_id" IS NULL OR "advances_to_match_id" <> "id")
);

CREATE INDEX "sport_event_matches_sport_event_round_id_idx" ON "sport_event_matches"("sport_event_round_id");

CREATE INDEX "sport_event_matches_home_sport_event_participant_id_idx" ON "sport_event_matches"("home_sport_event_participant_id");

CREATE INDEX "sport_event_matches_away_sport_event_participant_id_idx" ON "sport_event_matches"("away_sport_event_participant_id");

CREATE UNIQUE INDEX "sport_event_matches_sport_event_id_match_number_key" ON "sport_event_matches"("sport_event_id", "match_number");

-- Two matches cannot feed the same side of the next one.
CREATE UNIQUE INDEX "sport_event_matches_advances_to_match_id_advances_to_side_key" ON "sport_event_matches"("advances_to_match_id", "advances_to_side");

ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_sport_event_round_id_fkey" FOREIGN KEY ("sport_event_round_id") REFERENCES "sport_event_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A field row in the bracket cannot be removed from the field while a match names it.
ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_home_sport_event_participant_id_fkey" FOREIGN KEY ("home_sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_away_sport_event_participant_id_fkey" FOREIGN KEY ("away_sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NO ACTION rather than RESTRICT: replacing a bracket deletes every match in one statement, and
-- the check then runs once at its end, when no deleted match is still pointed at.
ALTER TABLE "sport_event_matches" ADD CONSTRAINT "sport_event_matches_advances_to_match_id_fkey" FOREIGN KEY ("advances_to_match_id") REFERENCES "sport_event_matches"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
