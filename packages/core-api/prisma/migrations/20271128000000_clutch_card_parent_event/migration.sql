-- #1820: a Clutch Card event names the season event it is rounds of. The 2025 World Series Clutch
-- Card is round 4 of the 2025 MLB Postseason; the Men's Final Four is round 5 of the NCAA
-- tournament. Its sport league names which rounds; the event names its parent event and copies
-- the rounds. The service sets the link whenever a Clutch Card event is created and refuses one it
-- cannot link (and a link on any other event); the checks below keep the columns consistent.

-- Each Clutch Card league's rounds of its parent league's season event. Reference data.
ALTER TABLE "sport_leagues" ADD COLUMN "parent_round_numbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

UPDATE "sport_leagues" AS round
SET "parent_round_numbers" = rounds."parent_round_numbers",
    "updated_at" = now()
FROM (VALUES
  ('AMERICAN_FOOTBALL', 'Championship Weekend', ARRAY[3]),
  ('AMERICAN_FOOTBALL', 'Super Bowl', ARRAY[4]),
  ('AMERICAN_FOOTBALL', 'CFP Semifinals', ARRAY[3]),
  ('AMERICAN_FOOTBALL', 'CFP National Championship', ARRAY[4]),
  ('BASKETBALL', 'NBA Conference Finals', ARRAY[3]),
  ('BASKETBALL', 'NBA Finals', ARRAY[4]),
  ('BASKETBALL', 'WNBA Semifinals', ARRAY[2]),
  ('BASKETBALL', 'WNBA Finals', ARRAY[3]),
  ('BASKETBALL', 'Men''s Final Four', ARRAY[5]),
  ('BASKETBALL', 'Men''s Basketball National Championship', ARRAY[6]),
  ('BASEBALL', 'League Championship Series', ARRAY[3]),
  ('BASEBALL', 'World Series', ARRAY[4]),
  ('HOCKEY', 'NHL Conference Finals', ARRAY[3]),
  ('HOCKEY', 'Stanley Cup Final', ARRAY[4]),
  ('HOCKEY', 'Men''s Frozen Four', ARRAY[3]),
  ('HOCKEY', 'Men''s Hockey National Championship', ARRAY[4]),
  ('SOCCER', 'Champions League Semifinals', ARRAY[4]),
  ('SOCCER', 'Champions League Final', ARRAY[5]),
  ('SOCCER', 'Women''s World Cup Semifinals', ARRAY[3]),
  ('SOCCER', 'Women''s World Cup Final', ARRAY[4])
) AS rounds ("sport", "round_name", "parent_round_numbers")
JOIN "sports" ON "sports"."sport"::text = rounds."sport"
WHERE round."sport_id" = "sports"."id"
  AND round."name" = rounds."round_name"
  AND round."parent_sport_league_id" IS NOT NULL;

-- A league's rounds are rounds of its parent league's events, so they need one.
ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_parent_rounds_need_parent_league"
  CHECK (COALESCE(cardinality("parent_round_numbers"), 0) = 0 OR "parent_sport_league_id" IS NOT NULL);

-- The event's parent and its rounds of it.
ALTER TABLE "sport_events" ADD COLUMN "parent_event_id" UUID,
ADD COLUMN "parent_round_numbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Finding a parent's Clutch Card events, and the check before deleting one, read by this column.
CREATE INDEX "sport_events_parent_event_id_idx" ON "sport_events"("parent_event_id");

ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_parent_event_id_fkey" FOREIGN KEY ("parent_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A parent and its rounds together, or neither.
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_parent_with_rounds"
  CHECK (("parent_event_id" IS NULL) = (COALESCE(cardinality("parent_round_numbers"), 0) = 0));

-- Backfill: each Clutch Card event already on the site links to the one event of its parent league
-- that was under way when it started (started by then and within the year before, not ended
-- before) and has the rounds, as the service finds a new event's parent. An
-- event with no such parent, or with more than one, is left unlinked: its parent was never loaded
-- (test data of another season, a test event with rolled dates).
WITH candidates AS (
  SELECT child."id" AS "child_id",
         parent."id" AS "parent_id",
         child_league."parent_round_numbers" AS "parent_round_numbers",
         count(*) OVER (PARTITION BY child."id") AS "candidate_count"
  FROM "sport_events" AS child
  JOIN "event_series" AS child_series ON child_series."id" = child."event_series_id"
  JOIN "sport_leagues" AS child_league ON child_league."id" = child_series."sport_league_id"
  JOIN "event_series" AS parent_series ON parent_series."sport_league_id" = child_league."parent_sport_league_id"
  JOIN "sport_events" AS parent ON parent."event_series_id" = parent_series."id"
  WHERE child_league."scoring_family" = 'COMPOSITE'
    AND cardinality(child_league."parent_round_numbers") > 0
    AND parent."sport" = child."sport"
    AND parent."start_date" <= child."start_date"
    AND parent."start_date" > child."start_date" - interval '366 days'
    AND (parent."end_date" IS NULL OR parent."end_date" >= child."start_date")
    AND parent."rounds" >= (SELECT max(round_number) FROM unnest(child_league."parent_round_numbers") AS round_number)
)
UPDATE "sport_events" AS child
SET "parent_event_id" = candidates."parent_id",
    "updated_at" = now(),
    "parent_round_numbers" = candidates."parent_round_numbers"
FROM candidates
WHERE child."id" = candidates."child_id"
  AND candidates."candidate_count" = 1;
