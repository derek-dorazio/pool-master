-- #625: Formula 1 as a third auto racing series, beside the NASCAR Cup Series and IndyCar.
--
-- The sport league. Sport leagues are normally created by an admin on the Manage pages, but the
-- series' contest templates carry its official points table and must name their sport league, so
-- the league is reference data here. Idempotent on the (sport_id, name) unique: an admin who
-- already created a "Formula 1" league keeps their row, and the templates below attach to it.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", 'Formula 1', TRUE, NOW(), NOW()
FROM "sports" s
WHERE s."sport" = 'AUTO_RACING'
ON CONFLICT ("sport_id", "name") DO NOTHING;

-- Three presets, one per selection type auto racing offers, each scored by the Formula 1 points
-- table for a grand prix: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 for the top ten, nothing below tenth,
-- and 0 for a driver who did not finish, was disqualified or did not start. Sprint races and the
-- fastest lap are not scored. The templates find their sport league by (sport, name), so they are
-- offered only for Formula 1 races.
--
-- Budget is the Formula 1 default and sorts first: with only ten scoring places in a field of
-- about 22, five picks from a priced field reads better than one pick from each of five tiers.
-- The tiered preset counts four picks, because a Formula 1 race is set to four tiers on the
-- event's Tiers card.
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
    'BUDGET_PICK',
    'formula-1-budget-points',
    'Pick 5 drivers under the cap, F1 points',
    'Pick five drivers whose prices fit under the salary cap. Every driver scores Formula 1 points: 25 for the win, 18 for second, 15 for third, down to 1 for tenth.',
    1,
    TRUE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 5, "countedScores": 5, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'TIERED',
    'formula-1-tiered-points',
    'Pick 1 driver from each tier, F1 points',
    'Pick one driver from each of the four tiers of the field. Every driver scores Formula 1 points: 25 for the win, 18 for second, 15 for third, down to 1 for tenth.',
    2,
    FALSE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'RANDOM_DRAW',
    'formula-1-random-draw-points',
    'Draw 1 driver each, F1 points',
    'The race sweep: the draw deals every entry one driver at random. It scores Formula 1 points: 25 for the win, 18 for second, 15 for third, down to 1 for tenth.',
    3,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], "didNotFinishPoints": 0 } } }'
  )
) AS preset("selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'AUTO_RACING'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = 'Formula 1';
