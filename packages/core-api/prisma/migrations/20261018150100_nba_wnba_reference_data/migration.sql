-- #706: the NBA and WNBA playoffs, two more sport leagues of BASKETBALL. Data only: a playoff
-- series is one bracket match whose winner advances, its scores the games each side won (4-2).
--
-- The sport leagues, reference data because their contest templates name them, each with its
-- round names (first to final), which the screens show in place of March Madness's. Both brackets
-- are fixed: no reseeding. The NBA play-in tournament fills the 7 and 8 seeds of each conference
-- through play-in places, as the First Four does. Idempotent on the (sport_id, name) unique: an
-- admin who already created either league keeps their row, and gets the round names.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "bracket_advancement", "round_names", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", 'FIXED', league."round_names", TRUE, NOW(), NOW()
FROM "sports" s
CROSS JOIN (VALUES
  ('NBA', ARRAY['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals']),
  ('WNBA', ARRAY['First Round', 'Semifinals', 'WNBA Finals'])
) AS league("name", "round_names")
WHERE s."sport" = 'BASKETBALL'
ON CONFLICT ("sport_id", "name") DO UPDATE SET "round_names" = EXCLUDED."round_names";

-- Each league's contest templates, scored by knockout round points for a series win: Doubling,
-- with and without the seed-difference upset bonus, for each selection type basketball has. The
-- NBA's 16 teams and the WNBA's 8 fall into four tiers; the tiered template picks a team from each
-- and is the league's default. The round values match each bracket's round count (four for the
-- NBA, three for the WNBA); contest creation refuses a preset for an event with another count.
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
  'nba-' || preset."template_key",
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
    'TIERED',
    'tiered-doubling',
    'Pick 1 team from each tier, Doubling',
    'Pick one team from each of the four tiers. A series win scores 1 point in the First Round, 2 in the Conference Semifinals, 4 in the Conference Finals and 8 in the NBA Finals.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'TIERED',
    'tiered-doubling-upset-bonus',
    'Pick 1 team from each tier, Doubling + upset bonus',
    'Pick one team from each of the four tiers. A series win scores 1 point in the First Round, 2 in the Conference Semifinals, 4 in the Conference Finals and 8 in the NBA Finals, and a win over a better seed adds the seed difference.',
    2,
    FALSE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling',
    'Pick 4 teams under the cap, Doubling',
    'Pick four teams whose prices fit under the salary cap. A series win scores 1 point in the First Round, 2 in the Conference Semifinals, 4 in the Conference Finals and 8 in the NBA Finals.',
    3,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling-upset-bonus',
    'Pick 4 teams under the cap, Doubling + upset bonus',
    'Pick four teams whose prices fit under the salary cap. A series win scores 1 point in the First Round, 2 in the Conference Semifinals, 4 in the Conference Finals and 8 in the NBA Finals, and a win over a better seed adds the seed difference.',
    4,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling',
    'Draw 1 team each, Doubling',
    'The playoff sweep: the draw deals every entry one team at random. A series win scores 1 point in the First Round, 2 in the Conference Semifinals, 4 in the Conference Finals and 8 in the NBA Finals.',
    5,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling-upset-bonus',
    'Draw 1 team each, Doubling + upset bonus',
    'The playoff sweep: the draw deals every entry one team at random. A series win scores 1 point in the First Round, 2 in the Conference Semifinals, 4 in the Conference Finals and 8 in the NBA Finals, and a win over a better seed adds the seed difference.',
    6,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  )
) AS preset("selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'BASKETBALL'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = 'NBA';

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
  'wnba-' || preset."template_key",
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
    'TIERED',
    'tiered-doubling',
    'Pick 1 team from each tier, Doubling',
    'Pick one team from each of the four tiers. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'TIERED',
    'tiered-doubling-upset-bonus',
    'Pick 1 team from each tier, Doubling + upset bonus',
    'Pick one team from each of the four tiers. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals, and a win over a better seed adds the seed difference.',
    2,
    FALSE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling',
    'Pick 3 teams under the cap, Doubling',
    'Pick three teams whose prices fit under the salary cap. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals.',
    3,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling-upset-bonus',
    'Pick 3 teams under the cap, Doubling + upset bonus',
    'Pick three teams whose prices fit under the salary cap. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals, and a win over a better seed adds the seed difference.',
    4,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling',
    'Draw 1 team each, Doubling',
    'The playoff sweep: the draw deals every entry one team at random. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals.',
    5,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling-upset-bonus',
    'Draw 1 team each, Doubling + upset bonus',
    'The playoff sweep: the draw deals every entry one team at random. A series win scores 1 point in the First Round, 2 in the Semifinals and 4 in the WNBA Finals, and a win over a better seed adds the seed difference.',
    6,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  )
) AS preset("selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'BASKETBALL'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = 'WNBA';
