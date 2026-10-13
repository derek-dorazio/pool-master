-- #624: auto racing's reference data. A separate migration from the one that adds AUTO_RACING to
-- the sport enum, because a new enum value cannot be used in the transaction that added it.
--
-- The sports row: a driver is an individual competitor, and a race is a RACE (one field, one
-- finishing order). Idempotent on the `sport` unique, as horse racing's row is.
INSERT INTO "sports" ("id", "sport", "participant_type", "tournament_format", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'AUTO_RACING', 'INDIVIDUAL', 'RACE', NOW(), NOW())
ON CONFLICT ("sport") DO NOTHING;

-- The two series auto racing launches with. Sport leagues are normally created by an admin on the
-- Manage pages, but each series' contest templates carry its own official points table and must
-- name their sport league, so the leagues are reference data here. Idempotent on the
-- (sport_id, name) unique: an admin who already created either league keeps their row, and the
-- templates below attach to it.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", TRUE, NOW(), NOW()
FROM "sports" s
CROSS JOIN (VALUES ('NASCAR Cup Series'), ('IndyCar')) AS league("name")
WHERE s."sport" = 'AUTO_RACING'
ON CONFLICT ("sport_id", "name") DO NOTHING;

-- Three presets per series, one per selection type auto racing offers, each scored by the
-- series' own points table, with 0 for a driver who did not finish, was disqualified or did not
-- start. The preset rides in the template's "scoring" key and is copied onto a contest created
-- from it as its participant scoring rule's settings. Each template finds its sport league by
-- (sport, name), so it is offered only for that series' races; template keys are distinct per
-- series. The tiered one is each series' default.
--   NASCAR Cup Series, 40 places: 40 for the winner, 35 for second, one fewer per place down to
--     1 for 36th, and 1 for 37th to 40th.
--   IndyCar, 33 places: 50, 40, 35, 32, 30, 28, 26, 24, 22, 20 for the top ten, 19 down to 6
--     for 11th to 24th, and 5 for 25th to 33rd.
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
  'AUTO_RACING',
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
    'NASCAR Cup Series',
    'TIERED',
    'nascar-cup-tiered-points',
    'Pick 1 driver from each tier, NASCAR points',
    'Pick one driver from each of the five tiers of the field. Every driver scores NASCAR Cup Series points: 40 for the win, 35 for second, then one fewer per place.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 5, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [40, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'NASCAR Cup Series',
    'BUDGET_PICK',
    'nascar-cup-budget-points',
    'Pick 5 drivers under the cap, NASCAR points',
    'Pick five drivers whose prices fit under the salary cap. Every driver scores NASCAR Cup Series points: 40 for the win, 35 for second, then one fewer per place.',
    2,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 5, "countedScores": 5, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [40, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'NASCAR Cup Series',
    'RANDOM_DRAW',
    'nascar-cup-random-draw-points',
    'Draw 1 driver each, NASCAR points',
    'The race sweep: the draw deals every entry one driver at random. It scores NASCAR Cup Series points: 40 for the win, 35 for second, then one fewer per place.',
    3,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [40, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'IndyCar',
    'TIERED',
    'indycar-tiered-points',
    'Pick 1 driver from each tier, IndyCar points',
    'Pick one driver from each of the five tiers of the field. Every driver scores IndyCar points: 50 for the win, 40 for second, 35 for third, down to 5 for 25th and below.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 5, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5], "didNotFinishPoints": 0 } } }'
  ),
  (
    'IndyCar',
    'BUDGET_PICK',
    'indycar-budget-points',
    'Pick 5 drivers under the cap, IndyCar points',
    'Pick five drivers whose prices fit under the salary cap. Every driver scores IndyCar points: 50 for the win, 40 for second, 35 for third, down to 5 for 25th and below.',
    2,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 5, "countedScores": 5, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5], "didNotFinishPoints": 0 } } }'
  ),
  (
    'IndyCar',
    'RANDOM_DRAW',
    'indycar-random-draw-points',
    'Draw 1 driver each, IndyCar points',
    'The race sweep: the draw deals every entry one driver at random. It scores IndyCar points: 50 for the win, 40 for second, 35 for third, down to 5 for 25th and below.',
    3,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5], "didNotFinishPoints": 0 } } }'
  )
) AS preset("league_name", "selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'AUTO_RACING'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset."league_name";
