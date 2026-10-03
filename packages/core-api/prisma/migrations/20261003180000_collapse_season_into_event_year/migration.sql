-- plans/147 slice 2 (#315) — Season collapses into the event. SportEvent's only parent becomes
-- its EventSeries, the year moves onto the edition as event_year, and the tour's current season
-- becomes current_event_year. The diamond (SportEvent -> Season -> SportLeague and
-- SportEvent -> EventSeries -> SportLeague) becomes a tree.
--
-- Scaffolded with `prisma migrate diff` from a database at the previous migration to the new
-- schema. The scaffold drops season_id in the same statement that adds event_year NOT NULL,
-- which leaves nothing to backfill from: Season is the only path from an event to its tour.
-- It is reordered here so every read of seasons happens before seasons is dropped:
--
--   0. refuse to run on data the backfill would have to guess about
--   1. add event_year and current_event_year, nullable
--   2. backfill event_year from season.year
--   3. backfill event_series_id for events that have none, from (season's tour, event name)
--   4. backfill current_event_year from the current season's year
--   5. tighten event_year and event_series_id to NOT NULL
--   6. one edition of a series per year
--   7. drop season_id, current_season_id and seasons
--
-- Step 0 runs before any write, so a refusal leaves the database exactly as it was. Each check
-- is one of the plan's pre-flight queries, corrected to the key the backfill actually produces
-- (see plans/147, Outcome). A migration that picked a winner silently could not be undone.
--
-- A refusal is not self-healing: Prisma records the failure and then answers P3009 to every
-- later deploy, so fixing the rows is not enough on its own. Check 0a — the one failure whose
-- rows nobody chose — is repaired automatically by
-- scripts/repair-season-collapse-migration.mjs, registered in run-migrations.mjs's
-- SCRIPTED_REPAIRS. The other three name rows an owner has to decide about, and stay manual.
--
-- Left out of the scaffold: five ALTERs (id defaults on four tables, two sport_leagues column
-- types) that are drift already present on main and unrelated to this change.

-- 0a. An event with no season has no path to a tour, so it cannot be given a series or a year.
DO $$
DECLARE
  n INTEGER;
  sample TEXT;
BEGIN
  SELECT COUNT(*), string_agg(id::text || ' (' || name || ')', ', ')
    INTO n, sample
    FROM (SELECT id, name FROM sport_events WHERE season_id IS NULL ORDER BY id LIMIT 10) s;
  IF n > 0 THEN
    SELECT COUNT(*) INTO n FROM sport_events WHERE season_id IS NULL;
    RAISE EXCEPTION 'plans/147: % sport_events have no season, so no tour to derive a series from and no year. Assign each a season or delete it, then re-run. First ones: %', n, sample;
  END IF;
END $$;

-- 0b. The diamond disagreeing: an event whose series and season belong to different tours. The
--     season is about to be dropped, so the event would silently move to the series' tour.
DO $$
DECLARE
  n INTEGER;
  sample TEXT;
BEGIN
  SELECT COUNT(*), string_agg(id::text || ' (' || name || ')', ', ')
    INTO n, sample
    FROM (
      SELECT e.id, e.name
        FROM sport_events e
        JOIN event_series es ON es.id = e.event_series_id
        JOIN seasons s ON s.id = e.season_id
       WHERE es.sport_league_id <> s.sport_league_id
       ORDER BY e.id
    ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'plans/147: % sport_events belong to a series of one tour and a season of another. Decide which tour each belongs to, then re-run: %', n, sample;
  END IF;
END $$;

-- 0c. Two editions of one series in one year, under the key the backfill will produce: the
--     existing series, or for an event with none the series its (tour, name) will resolve to;
--     and the season's year. Step 6's unique index would reject them, and merging or renaming
--     one is a decision about which event is real.
DO $$
DECLARE
  n INTEGER;
  sample TEXT;
BEGIN
  SELECT COUNT(*), string_agg(series_key || ' in ' || event_year || ' x' || editions, '; ')
    INTO n, sample
    FROM (
      SELECT COALESCE(es.id::text, s.sport_league_id::text || '/' || e.name) AS series_key,
             s.year AS event_year,
             COUNT(*) AS editions
        FROM sport_events e
        JOIN seasons s ON s.id = e.season_id
        LEFT JOIN event_series es
          ON es.id = e.event_series_id
          OR (e.event_series_id IS NULL AND es.sport_league_id = s.sport_league_id AND es.name = e.name)
       GROUP BY 1, 2
      HAVING COUNT(*) > 1
       ORDER BY 1, 2
    ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'plans/147: % (series, year) pairs have more than one edition. Merge, rename or delete the extras, then re-run: %', n, sample;
  END IF;
END $$;

-- 0d. A tour whose current season belongs to another tour. Carrying its year across would
--     point the tour at a year of somebody else's calendar.
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n
    FROM sport_leagues l
    JOIN seasons s ON s.id = l.current_season_id
   WHERE s.sport_league_id <> l.id;
  IF n > 0 THEN
    RAISE EXCEPTION 'plans/147: % sport_leagues have a current season belonging to another sport league. Clear or correct current_season_id, then re-run.', n;
  END IF;
END $$;

-- 1. AddColumn, nullable until backfilled
ALTER TABLE "sport_events" ADD COLUMN "event_year" INTEGER;
ALTER TABLE "sport_leagues" ADD COLUMN "current_event_year" INTEGER;

-- 2. Backfill event_year from the season. 0a guarantees every event has one.
UPDATE "sport_events" e
   SET "event_year" = s."year"
  FROM "seasons" s
 WHERE s."id" = e."season_id";

-- 3. Backfill event_series_id, as createEvent's find-or-create would have: the series named
--    like the event, on the season's tour. An existing series of that name is reused.
INSERT INTO "event_series" ("id", "sport_league_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), x."sport_league_id", x."name", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (
    SELECT DISTINCT s."sport_league_id", e."name"
      FROM "sport_events" e
      JOIN "seasons" s ON s."id" = e."season_id"
     WHERE e."event_series_id" IS NULL
  ) x
ON CONFLICT ("sport_league_id", "name") DO NOTHING;

UPDATE "sport_events" e
   SET "event_series_id" = es."id"
  FROM "seasons" s, "event_series" es
 WHERE e."event_series_id" IS NULL
   AND s."id" = e."season_id"
   AND es."sport_league_id" = s."sport_league_id"
   AND es."name" = e."name";

-- 4. Backfill current_event_year from the current season.
UPDATE "sport_leagues" l
   SET "current_event_year" = s."year"
  FROM "seasons" s
 WHERE s."id" = l."current_season_id";

-- 5. Tighten. Asserted first so a miss names the rows instead of a bare 23502.
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM sport_events WHERE event_year IS NULL OR event_series_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'plans/147: % sport_events are still missing a year or a series after the backfill.', n;
  END IF;
END $$;

ALTER TABLE "sport_events" ALTER COLUMN "event_year" SET NOT NULL;
ALTER TABLE "sport_events" ALTER COLUMN "event_series_id" SET NOT NULL;

-- A required parent: ON DELETE SET NULL no longer makes sense, so RESTRICT, as Prisma derives.
ALTER TABLE "sport_events" DROP CONSTRAINT "sport_events_event_series_id_fkey";
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_event_series_id_fkey" FOREIGN KEY ("event_series_id") REFERENCES "event_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. CreateIndex: one edition of a series per year.
CREATE UNIQUE INDEX "sport_events_event_series_id_event_year_key" ON "sport_events"("event_series_id", "event_year");

-- 7. Drop Season, now that nothing needs it.
ALTER TABLE "sport_events" DROP CONSTRAINT "sport_events_season_id_fkey";
ALTER TABLE "sport_events" DROP COLUMN "season_id";

ALTER TABLE "sport_leagues" DROP CONSTRAINT "sport_leagues_current_season_id_fkey";
DROP INDEX "sport_leagues_current_season_id_key";
ALTER TABLE "sport_leagues" DROP COLUMN "current_season_id";

ALTER TABLE "seasons" DROP CONSTRAINT "seasons_sport_league_id_fkey";
DROP TABLE "seasons";
