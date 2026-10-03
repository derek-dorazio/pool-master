-- plans/147 slice 1 (#314) — LeagueEvent becomes EventSeries, and gains the isActive lifecycle
-- it never had (decision 9).
--
-- Scaffolded with `prisma migrate dev --create-only`, which reads a model rename as a drop and a
-- create: it emitted DROP TABLE "league_events" and DROP COLUMN "league_event_id". Both are
-- replaced here with RENAMEs. league_events rows cannot be reconstructed — nothing else records
-- which series an event belongs to — so this migration moves no data and destroys none. Every
-- target name is the one `prisma migrate diff` derives from the schema.
--
-- The scaffold also carried five ALTERs (id defaults on four tables, two sport_leagues column
-- types) that are drift already present on main and unrelated to this change; they are left out.

-- RenameTable
ALTER TABLE "league_events" RENAME TO "event_series";
ALTER TABLE "event_series" RENAME CONSTRAINT "league_events_pkey" TO "event_series_pkey";
ALTER TABLE "event_series" RENAME CONSTRAINT "league_events_sport_league_id_fkey" TO "event_series_sport_league_id_fkey";
ALTER INDEX "league_events_sport_league_id_name_key" RENAME TO "event_series_sport_league_id_name_key";

-- AddColumn: every pre-existing series is active.
ALTER TABLE "event_series" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- RenameColumn (still nullable; slice 2 backfills and tightens it)
ALTER TABLE "sport_events" RENAME COLUMN "league_event_id" TO "event_series_id";
ALTER TABLE "sport_events" RENAME CONSTRAINT "sport_events_league_event_id_fkey" TO "sport_events_event_series_id_fkey";
