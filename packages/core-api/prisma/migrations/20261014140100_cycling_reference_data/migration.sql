-- #626: cycling's reference data. A separate migration from the one that adds CYCLING to the
-- sport enum, because a new enum value cannot be used in the transaction that added it.
--
-- The sports row: a rider is an individual competitor, and a race is a RACE (one field, one
-- finishing order). A Grand Tour is one event whose result is the final overall classification;
-- its stages are not rounds. Idempotent on the `sport` unique, as auto racing's row is.
INSERT INTO "sports" ("id", "sport", "participant_type", "tournament_format", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'CYCLING', 'INDIVIDUAL', 'RACE', NOW(), NOW())
ON CONFLICT ("sport") DO NOTHING;

-- The two tours cycling launches with. Sport leagues are normally created by an admin on the
-- Manage pages, but each tour's contest templates must name their sport league, so the leagues are
-- reference data here. Idempotent on the (sport_id, name) unique: an admin who already created
-- either league keeps their row, and the templates below attach to it.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", TRUE, NOW(), NOW()
FROM "sports" s
CROSS JOIN (VALUES ('UCI WorldTour'), ('UCI Women''s WorldTour')) AS league("name")
WHERE s."sport" = 'CYCLING'
ON CONFLICT ("sport_id", "name") DO NOTHING;

-- Three presets per tour, one per selection type cycling offers, each scored Top 10 on the final
-- overall classification: 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 for the first ten places, and 0 below
-- that and for a rider who abandoned, was disqualified or did not start. The preset rides in the
-- template's "scoring" key and is copied onto a contest created from it as its participant
-- scoring rule's settings. Each template finds its sport league by (sport, name), so it is offered
-- only for that tour's races; template keys are distinct per tour. The tiered one is each tour's
-- default.
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
  'CYCLING',
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
    'UCI WorldTour',
    'TIERED',
    'uci-worldtour-tiered-top-10',
    'Pick 1 rider from each tier, Top 10 points',
    'Pick one rider from each of the five tiers of the field. Every rider scores Top 10 points on the final overall classification: 10 for the winner, 9 for second, down to 1 for tenth.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 5, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'UCI WorldTour',
    'BUDGET_PICK',
    'uci-worldtour-budget-top-10',
    'Pick 5 riders under the cap, Top 10 points',
    'Pick five riders whose prices fit under the salary cap. Every rider scores Top 10 points on the final overall classification: 10 for the winner, 9 for second, down to 1 for tenth.',
    2,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 5, "countedScores": 5, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'UCI WorldTour',
    'RANDOM_DRAW',
    'uci-worldtour-random-draw-top-10',
    'Draw 1 rider each, Top 10 points',
    'The race sweep: the draw deals every entry one rider at random. It scores Top 10 points on the final overall classification: 10 for the winner, 9 for second, down to 1 for tenth.',
    3,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'UCI Women''s WorldTour',
    'TIERED',
    'uci-womens-worldtour-tiered-top-10',
    'Pick 1 rider from each tier, Top 10 points',
    'Pick one rider from each of the five tiers of the field. Every rider scores Top 10 points on the final overall classification: 10 for the winner, 9 for second, down to 1 for tenth.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 5, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'UCI Women''s WorldTour',
    'BUDGET_PICK',
    'uci-womens-worldtour-budget-top-10',
    'Pick 5 riders under the cap, Top 10 points',
    'Pick five riders whose prices fit under the salary cap. Every rider scores Top 10 points on the final overall classification: 10 for the winner, 9 for second, down to 1 for tenth.',
    2,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 5, "countedScores": 5, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  ),
  (
    'UCI Women''s WorldTour',
    'RANDOM_DRAW',
    'uci-womens-worldtour-random-draw-top-10',
    'Draw 1 rider each, Top 10 points',
    'The race sweep: the draw deals every entry one rider at random. It scores Top 10 points on the final overall classification: 10 for the winner, 9 for second, down to 1 for tenth.',
    3,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], "didNotFinishPoints": 0 } } }'
  )
) AS preset("league_name", "selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'CYCLING'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset."league_name";
