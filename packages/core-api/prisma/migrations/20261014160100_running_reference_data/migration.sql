-- #627: running's reference data. A separate migration from the one that adds RUNNING to the
-- sport enum, because a new enum value cannot be used in the transaction that added it.
--
-- The sports row: a runner is an individual competitor, and a race is a RACE (one field, one
-- finishing order). A marathon is one event with one round. Idempotent on the `sport` unique, as
-- cycling's row is.
INSERT INTO "sports" ("id", "sport", "participant_type", "tournament_format", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'RUNNING', 'INDIVIDUAL', 'RACE', NOW(), NOW())
ON CONFLICT ("sport") DO NOTHING;

-- The two series running launches with. Sport leagues are normally created by an admin on the
-- Manage pages, but each series' contest templates must name their sport league, so the leagues
-- are reference data here. Idempotent on the (sport_id, name) unique: an admin who already created
-- either league keeps their row, and the templates below attach to it.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", TRUE, NOW(), NOW()
FROM "sports" s
CROSS JOIN (VALUES ('World Marathon Majors (men)'), ('World Marathon Majors (women)')) AS league("name")
WHERE s."sport" = 'RUNNING'
ON CONFLICT ("sport_id", "name") DO NOTHING;

-- Three presets per series, one per selection type running offers, each scored Top 10 on the
-- official finishing order: 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 for the first ten places, and 0 below
-- that and for a runner who dropped out, was disqualified or did not start. The preset rides in
-- the template's "scoring" key and is copied onto a contest created from it as its participant
-- scoring rule's settings. Each template finds its sport league by (sport, name), so it is offered
-- only for that series' races; template keys are distinct per series. The tiered one is each
-- series' default: one runner from each of the four tiers, all four counted.
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
  "updated_at"
)
SELECT
  gen_random_uuid(),
  'RUNNING',
  l."id",
  NULL,
  'ROSTER',
  preset."selection_type"::"PrismaSelectionType",
  preset."template_key",
  preset."name",
  preset."description",
  preset."sort_order",
  preset."is_default",
  TRUE,
  preset."config_json"::jsonb,
  1,
  NOW()
FROM (VALUES
  (
    'World Marathon Majors (men)',
    'TIERED',
    'wmm-men-tiered-top-10',
    'Pick 1 runner from each tier, Top 10 points',
    'Pick one runner from each of the four tiers of the field. Every runner scores Top 10 points on the official finishing order: 10 for the winner, 9 for second, down to 1 for tenth.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'World Marathon Majors (men)',
    'BUDGET_PICK',
    'wmm-men-budget-top-10',
    'Pick 4 runners under the cap, Top 10 points',
    'Pick four runners whose prices fit under the salary cap. Every runner scores Top 10 points on the official finishing order: 10 for the winner, 9 for second, down to 1 for tenth.',
    2,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'World Marathon Majors (men)',
    'RANDOM_DRAW',
    'wmm-men-random-draw-top-10',
    'Draw 1 runner each, Top 10 points',
    'The race sweep: the draw deals every entry one runner at random. It scores Top 10 points on the official finishing order: 10 for the winner, 9 for second, down to 1 for tenth.',
    3,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'World Marathon Majors (women)',
    'TIERED',
    'wmm-women-tiered-top-10',
    'Pick 1 runner from each tier, Top 10 points',
    'Pick one runner from each of the four tiers of the field. Every runner scores Top 10 points on the official finishing order: 10 for the winner, 9 for second, down to 1 for tenth.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'World Marathon Majors (women)',
    'BUDGET_PICK',
    'wmm-women-budget-top-10',
    'Pick 4 runners under the cap, Top 10 points',
    'Pick four runners whose prices fit under the salary cap. Every runner scores Top 10 points on the official finishing order: 10 for the winner, 9 for second, down to 1 for tenth.',
    2,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'World Marathon Majors (women)',
    'RANDOM_DRAW',
    'wmm-women-random-draw-top-10',
    'Draw 1 runner each, Top 10 points',
    'The race sweep: the draw deals every entry one runner at random. It scores Top 10 points on the official finishing order: 10 for the winner, 9 for second, down to 1 for tenth.',
    3,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  )
) AS preset("league_name", "selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'RUNNING'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset."league_name";
