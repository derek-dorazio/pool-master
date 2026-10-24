-- #934: championship stat pools' model (`plans/championship-stat-pools.md` §3).
--
-- How a sport's results are scored, stored only as a sport league's override: a sport's own
-- family lives in its definition in code. COMPOSITE is a stat pool's: each game, a player scores
-- the sport's composite of their stats.
CREATE TYPE "PrismaScoringFamily" AS ENUM ('STROKE_PLAY', 'FINISH_POSITION', 'HEAD_TO_HEAD', 'COMPOSITE');

-- The component stats the four sports' composites count, one enum for every sport's stat lines.
CREATE TYPE "PrismaSportStat" AS ENUM ('TOTAL_BASES', 'RUNS', 'RUNS_BATTED_IN', 'WALKS', 'STOLEN_BASES', 'POINTS', 'REBOUNDS', 'ASSISTS', 'GOALS', 'SHOTS_ON_GOAL', 'PASSING_TOUCHDOWNS', 'RUSHING_TOUCHDOWNS', 'RECEIVING_TOUCHDOWNS', 'RECEPTIONS', 'PASSING_YARDS', 'RUSHING_YARDS', 'RECEIVING_YARDS');

-- A sport league's participant type and scoring family when not its sport's: the World Series
-- stat pool's field is players, scored by the composite family. Null keeps the sport's.
ALTER TABLE "sport_leagues" ADD COLUMN "participant_type" "PrismaParticipantType",
ADD COLUMN "scoring_family" "PrismaScoringFamily";

-- The composite family's extension of a participant round, as golf's round row is: one component
-- stat of a player's game. The composite is computed from the lines and never stored.
CREATE TABLE "sport_event_participant_stat_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participant_round_id" UUID NOT NULL,
    "stat" "PrismaSportStat" NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_stat_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sport_event_participant_stat_lines_participant_round_id_sta_key" ON "sport_event_participant_stat_lines"("participant_round_id", "stat");

ALTER TABLE "sport_event_participant_stat_lines" ADD CONSTRAINT "sport_event_participant_stat_lines_participant_round_id_fkey" FOREIGN KEY ("participant_round_id") REFERENCES "sport_event_participant_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
