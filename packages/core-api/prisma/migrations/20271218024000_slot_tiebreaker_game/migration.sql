-- League model slice 10g (#2048): each event slot names its tiebreaker game, the one Game whose
-- combined score every contest covering the slot guesses. A rule chooses it (the latest scheduled
-- start, ties to the lower Game id) and a root admin can choose another until it starts; who chose
-- it and when are kept. A sync finding kind says the rule chose again because the game was
-- cancelled or moved, and a background job runs the rule after each write to an event's games.

-- AlterEnum
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'REFRESH_SLOT_TIEBREAKERS';
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'TIEBREAKER_GAME_REPLACED';

-- AlterTable
ALTER TABLE "sport_event_slots"
    ADD COLUMN "tiebreaker_game_id" UUID,
    ADD COLUMN "tiebreaker_game_chosen_at" TIMESTAMPTZ,
    ADD COLUMN "tiebreaker_game_chosen_by_user_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_slots_tiebreaker_game_id_key" ON "sport_event_slots"("tiebreaker_game_id");

-- CreateIndex
CREATE INDEX "sport_event_slots_tiebreaker_game_chosen_by_user_id_idx" ON "sport_event_slots"("tiebreaker_game_chosen_by_user_id");

-- AddForeignKey
ALTER TABLE "sport_event_slots" ADD CONSTRAINT "sport_event_slots_tiebreaker_game_id_fkey" FOREIGN KEY ("tiebreaker_game_id") REFERENCES "sport_event_round_match_games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_slots" ADD CONSTRAINT "sport_event_slots_tiebreaker_game_chosen_by_user_id_fkey" FOREIGN KEY ("tiebreaker_game_chosen_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The chooser is set exactly when the time is: both while a root admin's choice stands, neither
-- while the rule's does. A deleted admin leaves the time, so the choice still stands.
ALTER TABLE "sport_event_slots" ADD CONSTRAINT "sport_event_slots_tiebreaker_chooser_check"
    CHECK ("tiebreaker_game_chosen_by_user_id" IS NULL OR "tiebreaker_game_chosen_at" IS NOT NULL);

-- Backfill: each slot's tiebreaker game by the rule, as SlotTiebreakerService chooses it. A Game is
-- a candidate while it is not moved and neither it nor its match is cancelled; its start is its
-- match's for Game 1 (the schedule sync writes kickoffs on the match until slice 14) and its own
-- for a later game of a series. Rows with no scheduled candidate stay null.
UPDATE "sport_event_slots" AS slot
SET "tiebreaker_game_id" = chosen."game_id"
FROM (
    SELECT DISTINCT ON (game."sport_event_slot_id")
        game."sport_event_slot_id" AS "slot_id",
        game."id" AS "game_id"
    FROM "sport_event_round_match_games" AS game
    JOIN "sport_event_round_matches" AS match ON match."id" = game."sport_event_round_match_id"
    WHERE game."moved_to_game_id" IS NULL
      AND game."status" <> 'CANCELLED'
      AND match."status" <> 'CANCELLED'
      AND (CASE WHEN game."game_number" = 1 THEN match."scheduled_date" ELSE game."scheduled_date" END) IS NOT NULL
    ORDER BY game."sport_event_slot_id",
        (CASE WHEN game."game_number" = 1 THEN match."scheduled_date" ELSE game."scheduled_date" END) DESC,
        game."id" ASC
) AS chosen
WHERE slot."id" = chosen."slot_id";
