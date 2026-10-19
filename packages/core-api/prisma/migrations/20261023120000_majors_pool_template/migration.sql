-- #714: a golf majors pool, one contest across a year's four majors. A contest template can name
-- the event series it covers; a contest created from it takes each of those series' editions of
-- its year as the edition is released for contests (a major is released once its field is set,
-- weeks apart, so the four cannot all be added when the contest is created).
ALTER TABLE "contest_config_templates"
  ADD COLUMN "event_series_names" TEXT[] NOT NULL DEFAULT '{}';

-- The PGA TOUR, reference data because its majors template names it. Idempotent on the
-- (sport_id, name) unique: a site whose sport data load already created it keeps its row.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", 'PGA TOUR', TRUE, NOW(), NOW()
FROM "sports" s
WHERE s."sport" = 'GOLF'
ON CONFLICT ("sport_id", "name") DO NOTHING;

-- The majors pool: golf's default tiered rules (one golfer from each tier, best four count) on
-- each of the four majors, named as the PGA TOUR's event series are (an event's series takes the
-- name it was created with).
INSERT INTO "contest_config_templates" (
  "id",
  "sport",
  "sport_league_id",
  "event_type",
  "contest_type",
  "selection_type",
  "template_key",
  "name",
  "description",
  "sort_order",
  "is_default",
  "active",
  "config_json",
  "schema_version",
  "event_series_names",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  'GOLF',
  l."id",
  NULL,
  'ROSTER',
  'TIERED',
  'pga-tour-majors-tiered',
  'Majors pool: one from each tier, 4 count',
  'One contest across the year''s four majors: the Masters, the PGA Championship, the U.S. Open and The Open. Each major joins the contest when it is released for contests. Pick one golfer from each tier for each major; the best four count. A major an entry misses scores 80 a round for each of its four golfers.',
  10,
  FALSE,
  TRUE,
  '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1 }'::jsonb,
  1,
  ARRAY['Masters Tournament', 'PGA Championship', 'U.S. Open', 'The Open Championship'],
  NOW()
FROM "sport_leagues" l
JOIN "sports" s ON s."id" = l."sport_id"
WHERE s."sport" = 'GOLF' AND l."name" = 'PGA TOUR'
ON CONFLICT ("sport", "event_type", "contest_type", "selection_type", "template_key") DO NOTHING;
