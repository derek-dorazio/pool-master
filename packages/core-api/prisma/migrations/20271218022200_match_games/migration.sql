-- League model slice 10 (#2007): every Match has its Games. A Game is one played game (a series is
-- one Match of several Games); a provider's game id lives in the Game's provider mapping, not on
-- the match, and a game's webhook notification time is kept on its Game (an event's own
-- notification, a golf round's, stays on the event). Three sync finding kinds name a webhook for an
-- unknown game, a re-issued game id and a game moved to another event.

-- AlterEnum
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'GAME_UNKNOWN';
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'GAME_ID_REISSUED';
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'GAME_MOVED';

-- CreateTable
CREATE TABLE "sport_event_round_match_games" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_id" UUID NOT NULL,
    "sport_event_round_match_id" UUID NOT NULL,
    "sport_event_slot_id" UUID NOT NULL,
    "game_number" INTEGER NOT NULL,
    "scheduled_date" TIMESTAMPTZ,
    "status" "PrismaMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "winner_side" "PrismaMatchSide",
    "home_score" INTEGER,
    "away_score" INTEGER,
    "completed_at" TIMESTAMPTZ,
    "moved_to_game_id" UUID,
    "last_provider_notification_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_round_match_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_event_round_match_game_provider_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_event_round_match_game_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_event_round_match_game_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sport_event_round_match_games_sport_event_id_sport_event_sl_idx" ON "sport_event_round_match_games"("sport_event_id", "sport_event_slot_id");

-- CreateIndex
CREATE INDEX "sport_event_round_match_games_moved_to_game_id_idx" ON "sport_event_round_match_games"("moved_to_game_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_games_sport_event_round_match_id_ga_key" ON "sport_event_round_match_games"("sport_event_round_match_id", "game_number");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_game_provider_mappings_provider_id__key" ON "sport_event_round_match_game_provider_mappings"("provider_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_match_game_provider_mappings_sport_event__key" ON "sport_event_round_match_game_provider_mappings"("sport_event_round_match_game_id", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_round_matches_event_id_key" ON "sport_event_round_matches"("sport_event_id", "id");

-- AddForeignKey
ALTER TABLE "sport_event_round_match_games" ADD CONSTRAINT "sport_event_round_match_games_match_fkey" FOREIGN KEY ("sport_event_id", "sport_event_round_match_id") REFERENCES "sport_event_round_matches"("sport_event_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_games" ADD CONSTRAINT "sport_event_round_match_games_event_slot_fkey" FOREIGN KEY ("sport_event_id", "sport_event_slot_id") REFERENCES "sport_event_slots"("sport_event_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_games" ADD CONSTRAINT "sport_event_round_match_games_moved_to_game_id_fkey" FOREIGN KEY ("moved_to_game_id") REFERENCES "sport_event_round_match_games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_game_provider_mappings" ADD CONSTRAINT "sport_event_round_match_game_provider_mappings_sport_event_fkey" FOREIGN KEY ("sport_event_round_match_game_id") REFERENCES "sport_event_round_match_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_event_round_match_game_provider_mappings" ADD CONSTRAINT "sport_event_round_match_game_provider_mappings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Every match gets its Game 1, in its round's slot, carrying the match's date, status, result and
-- the event's last webhook notification time.
INSERT INTO "sport_event_round_match_games" (
  "sport_event_id", "sport_event_round_match_id", "sport_event_slot_id", "game_number",
  "scheduled_date", "status", "winner_side", "home_score", "away_score", "completed_at",
  "last_provider_notification_at", "updated_at"
)
SELECT m."sport_event_id", m."id", r."sport_event_slot_id", 1,
  m."scheduled_date", m."status", m."winner_side", m."home_score", m."away_score", m."completed_at",
  e."last_provider_notification_at", now()
FROM "sport_event_round_matches" m
JOIN "sport_event_rounds" r ON r."id" = m."sport_event_round_id"
JOIN "sport_events" e ON e."id" = m."sport_event_id";

-- A match's linked provider game id becomes its Game 1's mapping, on the event's own provider. A
-- provider id is one Game's: where a game the provider moved left the same id linked on two
-- events, the latest-starting event's match keeps it (the match the provider lists it at now).
INSERT INTO "sport_event_round_match_game_provider_mappings" ("sport_event_round_match_game_id", "provider_id", "external_id", "updated_at")
SELECT DISTINCT ON (p."provider_id", m."external_game_id") g."id", p."provider_id", m."external_game_id", now()
FROM "sport_event_round_matches" m
JOIN "sport_events" e ON e."id" = m."sport_event_id"
JOIN "sport_event_round_match_games" g ON g."sport_event_round_match_id" = m."id" AND g."game_number" = 1
JOIN (
  SELECT DISTINCT ON ("sport_event_id") "sport_event_id", "provider_id"
  FROM "sport_event_provider_mappings"
  ORDER BY "sport_event_id", "created_at"
) p ON p."sport_event_id" = m."sport_event_id"
WHERE m."external_game_id" IS NOT NULL
ORDER BY p."provider_id", m."external_game_id", e."start_date" DESC, e."id";

-- DropIndex
DROP INDEX "sport_event_round_matches_sport_event_id_external_game_id_key";

-- AlterTable
ALTER TABLE "sport_event_round_matches" DROP COLUMN "external_game_id";

