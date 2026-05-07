-- CreateEnum
CREATE TYPE "PrismaSportCategory" AS ENUM ('GOLF', 'BASKETBALL', 'FOOTBALL', 'F1', 'NASCAR', 'TENNIS', 'SOCCER');

-- CreateEnum
CREATE TYPE "PrismaTournamentFormat" AS ENUM ('STROKE_PLAY_TOURNAMENT', 'KNOCKOUT_BRACKET', 'SERIES_PLAYOFF', 'ROUND_ROBIN_SEASON', 'WEEKLY_GAMES_SEASON', 'TIME_TRIAL_RACE', 'SEASON_OF_RACES', 'GROUP_STAGE_KNOCKOUT', 'MATCH_PLAY');

-- CreateEnum
CREATE TYPE "PrismaContestFormat" AS ENUM ('ROSTER', 'BRACKET', 'PICKEM_CONFIDENCE', 'SURVIVOR', 'PREDICT_TOP_N');

-- DropForeignKey
ALTER TABLE "contest_configurations" DROP CONSTRAINT "contest_configurations_contest_id_fkey";

-- DropForeignKey
ALTER TABLE "contest_entry_aggregation_rules" DROP CONSTRAINT "contest_entry_aggregation_rules_contest_configuration_id_fkey";

-- DropForeignKey
ALTER TABLE "contest_entry_participant_scores" DROP CONSTRAINT "contest_entry_participant_scores_roster_pick_id_fkey";

-- DropForeignKey
ALTER TABLE "contest_prize_definitions" DROP CONSTRAINT "contest_prize_definitions_contest_configuration_id_fkey";

-- DropForeignKey
ALTER TABLE "draft_pick_histories" DROP CONSTRAINT "draft_pick_histories_roster_pick_id_fkey";

-- DropForeignKey
ALTER TABLE "participant_contest_scoring_rules" DROP CONSTRAINT "participant_contest_scoring_rules_contest_configuration_id_fkey";

-- DropForeignKey
ALTER TABLE "participant_season_records" DROP CONSTRAINT "participant_season_records_participant_id_fkey";

-- DropForeignKey
ALTER TABLE "roster_picks" DROP CONSTRAINT "roster_picks_entry_id_fkey";

-- DropForeignKey
ALTER TABLE "roster_picks" DROP CONSTRAINT "roster_picks_sport_event_participant_id_fkey";

-- DropForeignKey
ALTER TABLE "sport_event_participant_source_data" DROP CONSTRAINT "sport_event_participant_source_data_sport_event_participant_id_";

-- DropForeignKey
ALTER TABLE "sport_event_participant_valuations" DROP CONSTRAINT "sport_event_participant_valuations_sport_event_participant_id_f";

-- DropForeignKey
ALTER TABLE "sport_event_participants" DROP CONSTRAINT "sport_event_participants_participant_id_fkey";

-- DropForeignKey
ALTER TABLE "sport_event_participants" DROP CONSTRAINT "sport_event_participants_sport_event_id_fkey";

-- DropIndex
DROP INDEX "contest_entries_contest_id_idx";

-- DropIndex
DROP INDEX "contest_entry_participant_scores_entry_id_roster_pick_id_key";

-- DropIndex
DROP INDEX "contest_entry_participant_scores_roster_pick_id_idx";

-- AlterTable
ALTER TABLE "contest_config_templates" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contest_configurations" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contest_entry_aggregation_rules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contest_entry_participant_score_events" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
-- contest_entry_participant_scores.pick_id is added NOT NULL with no backfill.
-- Per plans/117 §13.5 ("No-Data Clean Reworks") this slice assumes empty
-- contest_entry_participant_scores; dev/test DBs reseed and CI runs the
-- migration on a fresh DB. If a non-empty environment ever needs to apply
-- this migration, follow the two-step ADD/UPDATE/SET-NOT-NULL pattern.
ALTER TABLE "contest_entry_participant_scores" DROP COLUMN "roster_pick_id",
ADD COLUMN     "pick_id" UUID NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contest_entry_prize_awards" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contest_prize_definitions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contest_timing_policies" ALTER COLUMN "updated_at" DROP DEFAULT;

-- Backfill: rename legacy enum value SINGLE_EVENT → ROSTER on tables whose
-- contest_type column survives (config templates + timing policies). Per
-- plans/117 §4.2 the ContestFormat enum collapses SINGLE_EVENT into ROSTER.
UPDATE "contest_config_templates" SET "contest_type" = 'ROSTER' WHERE "contest_type" = 'SINGLE_EVENT';
UPDATE "contest_timing_policies" SET "contest_type" = 'ROSTER' WHERE "contest_type" = 'SINGLE_EVENT';

-- AlterTable
ALTER TABLE "contests" DROP COLUMN "contest_type",
ADD COLUMN     "contest_format" "PrismaContestFormat" NOT NULL DEFAULT 'ROSTER';

-- AlterTable: RENAME CONSTRAINT cannot share a single ALTER statement with column ops in Postgres.
-- draft_pick_histories.pick_id is added NOT NULL with no backfill. Per plans/117 §13.5
-- this slice assumes empty draft_pick_histories on application; dev/test DBs reseed
-- and CI runs the migration on a fresh DB.
ALTER TABLE "draft_pick_histories" RENAME CONSTRAINT "draft_picks_pkey" TO "draft_pick_histories_pkey";
ALTER TABLE "draft_pick_histories" DROP COLUMN "roster_pick_id",
ADD COLUMN     "pick_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "participant_contest_scoring_rules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "participants" DROP COLUMN "metadata";

-- AlterTable
ALTER TABLE "platform_runtime_configs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "session_id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sport_event_participant_valuations" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sport_event_participants" ADD COLUMN     "odds_to_win" DECIMAL(10,2),
ADD COLUMN     "seed_number" INTEGER,
ADD COLUMN     "world_ranking" INTEGER,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sports" DROP COLUMN "stat_schema",
ADD COLUMN     "category" "PrismaSportCategory" NOT NULL DEFAULT 'GOLF',
ADD COLUMN     "tournament_format" "PrismaTournamentFormat" NOT NULL DEFAULT 'STROKE_PLAY_TOURNAMENT';

-- AlterTable
ALTER TABLE "squad_memberships" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "squad_owner_invitations" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "squads" ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE "participant_season_records";

-- DropTable
DROP TABLE "roster_picks";

-- DropTable
DROP TABLE "sport_event_participant_source_data";

-- CreateTable
CREATE TABLE "contest_sport_events" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "sport_event_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_sport_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_picks" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "sport_event_participant_id" UUID NOT NULL,
    "contest_format" "PrismaContestFormat" NOT NULL,
    "period" INTEGER,
    "slot" INTEGER,
    "tier" VARCHAR(50),
    "cost" DECIMAL(12,2),
    "is_auto_picked" BOOLEAN NOT NULL DEFAULT false,
    "draft_round" INTEGER,
    "draft_pick_number" INTEGER,
    "picked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_pick_golf_roster_contributions" (
    "id" UUID NOT NULL,
    "contest_entry_pick_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "strokes" INTEGER NOT NULL,
    "score_to_par" INTEGER NOT NULL,
    "contribution" DECIMAL(12,4) NOT NULL,
    "contributed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_pick_golf_roster_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_participant_golf_rounds" (
    "id" UUID NOT NULL,
    "sport_event_participant_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "strokes" INTEGER NOT NULL,
    "score_to_par" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_participant_golf_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_tiers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "monthly_price_cents" INTEGER NOT NULL DEFAULT 0,
    "annual_price_cents" INTEGER NOT NULL DEFAULT 0,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "stripe_monthly_price_id" VARCHAR(255),
    "stripe_annual_price_id" VARCHAR(255),
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plan_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contest_sport_events_contest_id_idx" ON "contest_sport_events"("contest_id");

-- CreateIndex
CREATE INDEX "contest_sport_events_sport_event_id_idx" ON "contest_sport_events"("sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_sport_events_contest_id_sport_event_id_key" ON "contest_sport_events"("contest_id", "sport_event_id");

-- CreateIndex
CREATE INDEX "contest_entry_picks_entry_id_idx" ON "contest_entry_picks"("entry_id");

-- CreateIndex (partial uniques per plans/117 §7.1 — contest-format-scoped pick uniqueness)
CREATE UNIQUE INDEX "uq_pick_roster_participant"
  ON "contest_entry_picks" ("entry_id", "sport_event_participant_id")
  WHERE "contest_format" = 'ROSTER';

CREATE UNIQUE INDEX "uq_pick_period_slot"
  ON "contest_entry_picks" ("entry_id", "period", "slot")
  WHERE "contest_format" IN ('BRACKET', 'PICKEM_CONFIDENCE');

CREATE UNIQUE INDEX "uq_pick_predicted_position"
  ON "contest_entry_picks" ("entry_id", "slot")
  WHERE "contest_format" = 'PREDICT_TOP_N';

CREATE UNIQUE INDEX "uq_pick_survivor_week"
  ON "contest_entry_picks" ("entry_id", "period")
  WHERE "contest_format" = 'SURVIVOR';

-- CreateIndex
CREATE INDEX "contest_entry_pick_golf_roster_contributions_contest_entry__idx" ON "contest_entry_pick_golf_roster_contributions"("contest_entry_pick_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_pick_golf_roster_contributions_contest_entry__key" ON "contest_entry_pick_golf_roster_contributions"("contest_entry_pick_id", "round");

-- CreateIndex
CREATE INDEX "sport_event_participant_golf_rounds_sport_event_participant_idx" ON "sport_event_participant_golf_rounds"("sport_event_participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_participant_golf_rounds_sport_event_participant_key" ON "sport_event_participant_golf_rounds"("sport_event_participant_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "plan_tiers_slug_key" ON "plan_tiers"("slug");

-- CreateIndex
CREATE INDEX "contest_entry_participant_scores_pick_id_idx" ON "contest_entry_participant_scores"("pick_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_participant_scores_entry_id_pick_id_key" ON "contest_entry_participant_scores"("entry_id", "pick_id");

-- CreateIndex
CREATE INDEX "draft_pick_histories_pick_id_idx" ON "draft_pick_histories"("pick_id");

-- RenameForeignKey
ALTER TABLE "contest_entry_participant_score_events" RENAME CONSTRAINT "contest_entry_participant_score_events_contest_entry_participan" TO "contest_entry_participant_score_events_contest_entry_parti_fkey";

-- RenameForeignKey
ALTER TABLE "contest_entry_participant_score_events" RENAME CONSTRAINT "contest_entry_participant_score_events_participant_contest_scor" TO "contest_entry_participant_score_events_participant_contest_fkey";

-- RenameForeignKey
ALTER TABLE "draft_pick_histories" RENAME CONSTRAINT "draft_picks_draft_session_id_fkey" TO "draft_pick_histories_draft_session_id_fkey";

-- RenameForeignKey
ALTER TABLE "draft_pick_histories" RENAME CONSTRAINT "draft_picks_entry_id_fkey" TO "draft_pick_histories_entry_id_fkey";

-- AddForeignKey
ALTER TABLE "contest_sport_events" ADD CONSTRAINT "contest_sport_events_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_sport_events" ADD CONSTRAINT "contest_sport_events_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_configurations" ADD CONSTRAINT "contest_configurations_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_contest_scoring_rules" ADD CONSTRAINT "participant_contest_scoring_rules_contest_configuration_id_fkey" FOREIGN KEY ("contest_configuration_id") REFERENCES "contest_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_aggregation_rules" ADD CONSTRAINT "contest_entry_aggregation_rules_contest_configuration_id_fkey" FOREIGN KEY ("contest_configuration_id") REFERENCES "contest_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_prize_definitions" ADD CONSTRAINT "contest_prize_definitions_contest_configuration_id_fkey" FOREIGN KEY ("contest_configuration_id") REFERENCES "contest_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_picks" ADD CONSTRAINT "contest_entry_picks_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "contest_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_picks" ADD CONSTRAINT "contest_entry_picks_sport_event_participant_id_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_pick_golf_roster_contributions" ADD CONSTRAINT "contest_entry_pick_golf_roster_contributions_contest_entry_fkey" FOREIGN KEY ("contest_entry_pick_id") REFERENCES "contest_entry_picks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_participant_scores" ADD CONSTRAINT "contest_entry_participant_scores_pick_id_fkey" FOREIGN KEY ("pick_id") REFERENCES "contest_entry_picks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_pick_histories" ADD CONSTRAINT "draft_pick_histories_pick_id_fkey" FOREIGN KEY ("pick_id") REFERENCES "contest_entry_picks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participants" ADD CONSTRAINT "sport_event_participants_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participants" ADD CONSTRAINT "sport_event_participants_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_golf_rounds" ADD CONSTRAINT "sport_event_participant_golf_rounds_sport_event_participan_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_participant_valuations" ADD CONSTRAINT "sport_event_participant_valuations_sport_event_participant_fkey" FOREIGN KEY ("sport_event_participant_id") REFERENCES "sport_event_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "contest_config_templates_sport_contest_type_active_sort_order_i" RENAME TO "contest_config_templates_sport_contest_type_active_sort_ord_idx";

-- RenameIndex
ALTER INDEX "contest_config_templates_sport_event_type_contest_type_config_m" RENAME TO "contest_config_templates_sport_event_type_contest_type_conf_key";

-- RenameIndex
ALTER INDEX "contest_entry_participant_score_events_contest_entry_participan" RENAME TO "contest_entry_participant_score_events_contest_entry_partic_idx";

-- RenameIndex
ALTER INDEX "contest_entry_participant_score_events_participant_contest_scor" RENAME TO "contest_entry_participant_score_events_participant_contest__idx";

-- RenameIndex
ALTER INDEX "contest_prize_definitions_unique_sort_order" RENAME TO "contest_prize_definitions_contest_configuration_id_sort_ord_key";

-- RenameIndex
ALTER INDEX "participant_contest_scoring_rules_unique_sort_order" RENAME TO "participant_contest_scoring_rules_contest_configuration_id__key";

-- RenameIndex
ALTER INDEX "sport_event_participant_valuations_sport_event_participant_id_i" RENAME TO "sport_event_participant_valuations_sport_event_participant__idx";

-- RenameIndex
ALTER INDEX "sport_event_participant_valuations_unique_source" RENAME TO "sport_event_participant_valuations_sport_event_participant__key";

