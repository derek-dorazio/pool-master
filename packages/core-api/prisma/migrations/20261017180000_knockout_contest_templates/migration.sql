-- #699: the NCAA Division I tournaments' contest templates, scored by knockout round points.
--
-- Two scorings, each offered for every selection type basketball has:
--
-- - "Doubling": a win is worth 1 point in the First Round, 2 in the Second Round, 4 in the Sweet
--   16, 8 in the Elite Eight, 16 in the Final Four and 32 in the National Championship.
-- - "Doubling + upset bonus": the same, and a win by the worse seed adds the seed difference
--   (multiplier 1, no cap). An unseeded team counts as the field's worst seed.
--
-- The six round values match the March Madness bracket's six rounds; contest creation refuses
-- the preset for a tournament with another round count, where the commissioner gives their own.
-- The preset rides in the template's "scoring" key and is copied onto a contest created from it.
-- Each template finds its sport league by (sport, name); template keys are distinct per league.
-- The tiered Doubling one is each league's default.
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
  'BASKETBALL',
  l."id",
  NULL,
  'ROSTER',
  preset."selection_type"::"PrismaSelectionType",
  league."key_prefix" || '-' || preset."template_key",
  preset."name",
  preset."description",
  preset."sort_order",
  preset."is_default",
  TRUE,
  preset."config_json"::jsonb,
  1,
  NOW()
FROM (VALUES
  ('NCAA Division I Men', 'ncaa-men'),
  ('NCAA Division I Women', 'ncaa-women')
) AS league("name", "key_prefix")
CROSS JOIN (VALUES
  (
    'TIERED',
    'tiered-doubling',
    'Pick 1 team from each tier, Doubling',
    'Pick one team from each of the four seed-line tiers. A win scores 1 point in the First Round, doubling each round to 32 for the National Championship.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8, 16, 32], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'TIERED',
    'tiered-doubling-upset-bonus',
    'Pick 1 team from each tier, Doubling + upset bonus',
    'Pick one team from each of the four seed-line tiers. A win scores 1 point in the First Round, doubling each round to 32 for the National Championship, and a win over a better seed adds the seed difference.',
    2,
    FALSE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8, 16, 32], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling',
    'Pick 4 teams under the cap, Doubling',
    'Pick four teams whose prices fit under the salary cap. A win scores 1 point in the First Round, doubling each round to 32 for the National Championship.',
    3,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8, 16, 32], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling-upset-bonus',
    'Pick 4 teams under the cap, Doubling + upset bonus',
    'Pick four teams whose prices fit under the salary cap. A win scores 1 point in the First Round, doubling each round to 32 for the National Championship, and a win over a better seed adds the seed difference.',
    4,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8, 16, 32], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling',
    'Draw 1 team each, Doubling',
    'The bracket sweep: the draw deals every entry one team at random. A win scores 1 point in the First Round, doubling each round to 32 for the National Championship.',
    5,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8, 16, 32], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling-upset-bonus',
    'Draw 1 team each, Doubling + upset bonus',
    'The bracket sweep: the draw deals every entry one team at random. A win scores 1 point in the First Round, doubling each round to 32 for the National Championship, and a win over a better seed adds the seed difference.',
    6,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8, 16, 32], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  )
) AS preset("selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'BASKETBALL'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = league."name";
