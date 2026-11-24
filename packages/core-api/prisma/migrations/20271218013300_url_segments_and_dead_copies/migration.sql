-- League model 3c (#2042): stored URL segments and the sport's display order; the `sport` copies,
-- the dead pick columns (#632) and ContestPrizeDefinition dropped.

-- Sport: its URL segment and display order, set to the values the code computed until now, so no
-- address changes (`american-football`, `horse-racing`).
ALTER TABLE "sports" ADD COLUMN "url_segment" VARCHAR(50),
ADD COLUMN "display_order" INTEGER;

UPDATE "sports" SET
  "url_segment" = lower(replace("sport"::text, '_', '-')),
  "display_order" = CASE "sport"::text
    WHEN 'AMERICAN_FOOTBALL' THEN 0
    WHEN 'BASKETBALL' THEN 1
    WHEN 'BASEBALL' THEN 2
    WHEN 'HOCKEY' THEN 3
    WHEN 'SOCCER' THEN 4
    WHEN 'GOLF' THEN 5
    WHEN 'AUTO_RACING' THEN 6
    WHEN 'TENNIS' THEN 7
    WHEN 'HORSE_RACING' THEN 8
    WHEN 'CYCLING' THEN 9
    WHEN 'RUNNING' THEN 10
  END;

ALTER TABLE "sports" ALTER COLUMN "url_segment" SET NOT NULL,
ALTER COLUMN "display_order" SET NOT NULL;
CREATE UNIQUE INDEX "sports_url_segment_key" ON "sports"("url_segment");
CREATE UNIQUE INDEX "sports_display_order_key" ON "sports"("display_order");
ALTER TABLE "sports" ADD CONSTRAINT sports_url_segment_check CHECK ("url_segment" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Sport league: its URL segment within its sport, set to the value How to Play's links use today
-- (`?league=ncaa-division-i-men`, `copa-america`): the name without accents, lower case, each run
-- of other characters one dash.
ALTER TABLE "sport_leagues" ADD COLUMN "url_segment" VARCHAR(100);

UPDATE "sport_leagues" SET "url_segment" = trim(BOTH '-' FROM regexp_replace(
  lower(translate("name", 'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇç', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc')),
  '[^a-z0-9]+', '-', 'g'));

ALTER TABLE "sport_leagues" ALTER COLUMN "url_segment" SET NOT NULL;
CREATE UNIQUE INDEX "sport_leagues_sport_id_url_segment_key" ON "sport_leagues"("sport_id", "url_segment");
ALTER TABLE "sport_leagues" ADD CONSTRAINT sport_leagues_url_segment_check CHECK ("url_segment" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Event page: `slug` is renamed `url_segment`, keeping every row.
ALTER TABLE "event_pages" RENAME COLUMN "slug" TO "url_segment";
ALTER INDEX "event_pages_sport_slug_key" RENAME TO "event_pages_sport_url_segment_key";
ALTER TABLE "event_pages" RENAME CONSTRAINT event_pages_slug_check TO event_pages_url_segment_check;
-- A page's sport is a sport row, so its address and order read the sport's own.
ALTER TABLE "event_pages" ADD CONSTRAINT "event_pages_sport_fkey" FOREIGN KEY ("sport") REFERENCES "sports"("sport") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The `sport` copies: each is read through the row's sport league.
DROP INDEX "contest_config_templates_sport_contest_type_active_sort_ord_idx";
ALTER TABLE "contest_config_templates" DROP COLUMN "sport";
DROP INDEX "sport_events_sport_status_idx";
ALTER TABLE "sport_events" DROP COLUMN "sport";
DROP INDEX "provider_sync_runs_sport_created_at_idx";
ALTER TABLE "provider_sync_runs" DROP COLUMN "sport";
-- A run's sport is now its sport league's, so its league id becomes a foreign key. A run naming
-- a league that no longer exists keeps the run, unscoped, as a deleted league would leave it.
UPDATE "provider_sync_runs" SET "sport_league_id" = NULL
WHERE "sport_league_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sport_leagues" WHERE "sport_leagues"."id" = "provider_sync_runs"."sport_league_id");
ALTER TABLE "provider_sync_runs" ADD CONSTRAINT "provider_sync_runs_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Picks (#632): only roster contests write picks, so the copied contest format, and the period and
-- slot nothing writes, go. The roster-only unique index goes with the format column, and one
-- unique index over every pick replaces it (it also serves the entry lookups the plain index did).
DROP INDEX "uq_pick_roster_participant";
DROP INDEX "contest_entry_picks_entry_id_idx";
ALTER TABLE "contest_entry_picks" DROP COLUMN "contest_format",
DROP COLUMN "period",
DROP COLUMN "slot";
CREATE UNIQUE INDEX "uq_pick_entry_participant" ON "contest_entry_picks"("entry_id", "sport_event_participant_id");

-- ContestPrizeDefinition: never read; prizes are not configured per contest.
DROP TABLE "contest_prize_definitions";
DROP TYPE "PrismaPrizePayoutType";
