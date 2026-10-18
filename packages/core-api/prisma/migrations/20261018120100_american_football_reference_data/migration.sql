-- #702: American football's reference data, a separate migration from the one that adds
-- AMERICAN_FOOTBALL to the sport enum: a new enum value cannot be used in the transaction that
-- added it.
--
-- The sports row: a team competes, and an event is a KNOCKOUT_BRACKET. Idempotent on the `sport`
-- unique, as the other sports' rows are.
INSERT INTO "sports" ("id", "sport", "participant_type", "tournament_format", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'AMERICAN_FOOTBALL', 'TEAM', 'KNOCKOUT_BRACKET', NOW(), NOW())
ON CONFLICT ("sport") DO NOTHING;

-- The NFL sport league, reference data because its contest templates name it. It reseeds after
-- Wild Card weekend (#722): the best seed left in each conference hosts the worst. Idempotent on
-- the (sport_id, name) unique.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "bracket_advancement", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", 'NFL', 'RESEED_BY_SEED', TRUE, NOW(), NOW()
FROM "sports" s
WHERE s."sport" = 'AMERICAN_FOOTBALL'
ON CONFLICT ("sport_id", "name") DO NOTHING;

-- The NFL playoffs' contest templates, scored by knockout round points: Doubling (1, 2, 4 and 8
-- points for a win in the Wild Card, Divisional, Conference Championship and Super Bowl rounds),
-- with and without the seed-difference upset bonus, for each selection type the sport has. The
-- tiered one picks a team from each of the seven seed lines and is the league's default. Contest
-- creation refuses a preset for an event with another round count.
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
  'AMERICAN_FOOTBALL',
  l."id",
  NULL,
  'ROSTER',
  preset."selection_type"::"PrismaSelectionType",
  'nfl-' || preset."template_key",
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
    'Pick 1 team from each seed line, Doubling',
    'Pick one team from each of the seven seed lines. A win scores 1 point on Wild Card weekend, 2 in the Divisional round, 4 in the Conference Championship and 8 in the Super Bowl; a bye scores nothing.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 7, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'TIERED',
    'tiered-doubling-upset-bonus',
    'Pick 1 team from each seed line, Doubling + upset bonus',
    'Pick one team from each of the seven seed lines. A win scores 1 point on Wild Card weekend, 2 in the Divisional round, 4 in the Conference Championship and 8 in the Super Bowl; a bye scores nothing, and a win over a better seed adds the seed difference.',
    2,
    FALSE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 7, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling',
    'Pick 4 teams under the cap, Doubling',
    'Pick four teams whose prices fit under the salary cap. A win scores 1 point on Wild Card weekend, 2 in the Divisional round, 4 in the Conference Championship and 8 in the Super Bowl; a bye scores nothing.',
    3,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling-upset-bonus',
    'Pick 4 teams under the cap, Doubling + upset bonus',
    'Pick four teams whose prices fit under the salary cap. A win scores 1 point on Wild Card weekend, 2 in the Divisional round, 4 in the Conference Championship and 8 in the Super Bowl; a bye scores nothing, and a win over a better seed adds the seed difference.',
    4,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling',
    'Draw 1 team each, Doubling',
    'The playoff sweep: the draw deals every entry one team at random. A win scores 1 point on Wild Card weekend, 2 in the Divisional round, 4 in the Conference Championship and 8 in the Super Bowl; a bye scores nothing.',
    5,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling-upset-bonus',
    'Draw 1 team each, Doubling + upset bonus',
    'The playoff sweep: the draw deals every entry one team at random. A win scores 1 point on Wild Card weekend, 2 in the Divisional round, 4 in the Conference Championship and 8 in the Super Bowl; a bye scores nothing, and a win over a better seed adds the seed difference.',
    6,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  )
) AS preset("selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'AMERICAN_FOOTBALL'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = 'NFL';
