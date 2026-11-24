-- League model 1 (#1997): the Provider and ProviderLeague tables, seeded here; each sport
-- league's match keyword and sync provider become a SportLeagueProviderMapping, the synced one
-- selected. Each environment's rows are its own: production's paid requestsPerMinute is set on
-- the Providers page after deploy.

-- CreateEnum
CREATE TYPE "PrismaProviderCode" AS ENUM ('BALLDONTLIE');

-- CreateEnum
CREATE TYPE "PrismaProviderWebhookEventSet" AS ENUM ('GAME_PERIODS', 'GAME_HALVES', 'GOLF_ROUNDS');

-- AlterTable
ALTER TABLE "sport_leagues" ADD COLUMN "selected_provider_mapping_id" UUID;

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" "PrismaProviderCode" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "base_url" VARCHAR(500) NOT NULL,
    "requests_per_minute" INTEGER NOT NULL,
    "webhooks_enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_poll_minutes" INTEGER NOT NULL,
    "webhook_round_poll_minutes" INTEGER NOT NULL,
    "has_player_stats" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_leagues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sport_id" UUID NOT NULL,
    "webhook_event_set" "PrismaProviderWebhookEventSet" NOT NULL,
    "quiet_after_minutes" INTEGER NOT NULL,
    "typical_game_minutes" INTEGER NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "provider_leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_league_provider_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "provider_league_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "providers_code_key" ON "providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "providers_priority_key" ON "providers"("priority");

-- CreateIndex
CREATE INDEX "provider_leagues_sport_id_idx" ON "provider_leagues"("sport_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_leagues_provider_id_code_key" ON "provider_leagues"("provider_id", "code");

-- CreateIndex
CREATE INDEX "sport_league_provider_mappings_provider_league_id_idx" ON "sport_league_provider_mappings"("provider_league_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_provider_mappings_sport_league_id_provider_lea_key" ON "sport_league_provider_mappings"("sport_league_id", "provider_league_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_provider_mappings_sport_league_id_id_key" ON "sport_league_provider_mappings"("sport_league_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_leagues_id_selected_provider_mapping_id_key" ON "sport_leagues"("id", "selected_provider_mapping_id");

-- AddForeignKey
ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_id_selected_provider_mapping_id_fkey" FOREIGN KEY ("id", "selected_provider_mapping_id") REFERENCES "sport_league_provider_mappings"("sport_league_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "provider_leagues" ADD CONSTRAINT "provider_leagues_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_leagues" ADD CONSTRAINT "provider_leagues_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "sports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_provider_mappings" ADD CONSTRAINT "sport_league_provider_mappings_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_provider_mappings" ADD CONSTRAINT "sport_league_provider_mappings_provider_league_id_fkey" FOREIGN KEY ("provider_league_id") REFERENCES "provider_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The ranges the API holds each setting to (shared/domain/provider-settings.ts), checked here too.
ALTER TABLE "providers"
  ADD CONSTRAINT "providers_requests_per_minute_range" CHECK ("requests_per_minute" BETWEEN 1 AND 6000),
  ADD CONSTRAINT "providers_webhook_poll_minutes_range" CHECK ("webhook_poll_minutes" BETWEEN 1 AND 240),
  ADD CONSTRAINT "providers_webhook_round_poll_minutes_range" CHECK ("webhook_round_poll_minutes" BETWEEN 1 AND 240),
  ADD CONSTRAINT "providers_priority_range" CHECK ("priority" BETWEEN 1 AND 100);
ALTER TABLE "provider_leagues"
  ADD CONSTRAINT "provider_leagues_quiet_after_minutes_range" CHECK ("quiet_after_minutes" BETWEEN 1 AND 1440),
  ADD CONSTRAINT "provider_leagues_typical_game_minutes_range" CHECK ("typical_game_minutes" BETWEEN 1 AND 1440);

-- Seed: BALLDONTLIE at its free-tier rate, and its leagues (webhook timing per league, #1499;
-- each league's usual game length, which replaces the per-sport table in code).
INSERT INTO "providers" ("id", "code", "name", "base_url", "requests_per_minute", "webhooks_enabled", "webhook_poll_minutes", "webhook_round_poll_minutes", "has_player_stats", "is_enabled", "priority", "updated_at")
VALUES ('6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11', 'BALLDONTLIE', 'BALLDONTLIE', 'https://api.balldontlie.io', 5, true, 15, 2, false, true, 1, now());

INSERT INTO "provider_leagues" ("provider_id", "code", "name", "sport_id", "webhook_event_set", "quiet_after_minutes", "typical_game_minutes", "updated_at")
SELECT '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11', l.code, l.name, s.id, l.event_set::"PrismaProviderWebhookEventSet", l.quiet, l.typical, now()
FROM (VALUES
  ('pga',      'PGA TOUR',                'GOLF',              'GOLF_ROUNDS',  360, 360),
  ('nfl',      'NFL',                     'AMERICAN_FOOTBALL', 'GAME_PERIODS',  90, 210),
  ('ncaaf',    'College Football',        'AMERICAN_FOOTBALL', 'GAME_PERIODS', 110, 210),
  ('nba',      'NBA',                     'BASKETBALL',        'GAME_PERIODS',  75, 150),
  ('ncaab',    'NCAA Men''s Basketball',   'BASKETBALL',        'GAME_PERIODS',  90, 150),
  ('ncaaw',    'NCAA Women''s Basketball', 'BASKETBALL',        'GAME_PERIODS',  75, 150),
  ('wnba',     'WNBA',                    'BASKETBALL',        'GAME_PERIODS',  75, 150),
  ('nhl',      'NHL',                     'HOCKEY',            'GAME_PERIODS',  90, 150),
  ('mlb',      'MLB',                     'BASEBALL',          'GAME_PERIODS', 210, 180),
  ('epl',      'Premier League',          'SOCCER',            'GAME_HALVES',   90, 120),
  ('worldcup', 'FIFA World Cup',          'SOCCER',            'GAME_HALVES',  150, 120)
) AS l(code, name, sport, event_set, quiet, typical)
JOIN "sports" s ON s."sport"::text = l.sport;

-- Each sport league whose match keyword named one of the adapter's leagues is mapped to it. A
-- Clutch Card round league's keyword names no provider league, so it gets no mapping (slice 1b
-- deletes those leagues).
INSERT INTO "sport_league_provider_mappings" ("sport_league_id", "provider_league_id", "updated_at")
SELECT sl."id", pl."id", now()
FROM "sport_leagues" sl
JOIN (VALUES
  ('pga tour', 'pga'), ('nfl', 'nfl'), ('cfp', 'ncaaf'), ('ncaam', 'ncaab'), ('ncaaw', 'ncaaw'),
  ('nba', 'nba'), ('wnba', 'wnba'), ('nhl', 'nhl'), ('mlb', 'mlb'), ('epl', 'epl'), ('fifawc', 'worldcup')
) AS k(keyword, code) ON lower(btrim(sl."match_keyword")) = k.keyword
JOIN "provider_leagues" pl ON pl."code" = k.code AND pl."provider_id" = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11';

-- A league BALLDONTLIE synced keeps syncing: its mapping is selected.
UPDATE "sport_leagues" sl
SET "selected_provider_mapping_id" = m."id"
FROM "sport_league_provider_mappings" m
WHERE m."sport_league_id" = sl."id" AND sl."event_sync_provider_id" = 'balldontlie';

-- AlterTable
ALTER TABLE "sport_leagues" DROP COLUMN "event_sync_provider_id",
DROP COLUMN "match_keyword";
