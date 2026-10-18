-- #707: the College Football Playoff, a sport league of AMERICAN_FOOTBALL. Data only: 12 teams
-- in four rounds, the top four seeds on byes into the quarterfinals (a team placed straight into
-- round 2, as the NFL's 1 seeds are), first-round games at the higher seed's campus and the rest
-- at bowl sites. The bracket is fixed, with no reseeding.
--
-- The sport league, reference data because its contest templates name it, with its round names
-- (first to final), shown in place of the NFL's, and six tiers: 12 teams two to a tier, where
-- football's default seven would leave two tiers of one. Idempotent on the (sport_id, name)
-- unique: an admin who already created the league keeps their row, and gets the names and tiers.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "bracket_advancement", "round_names", "tier_count", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", 'College Football Playoff', 'FIXED', ARRAY['First Round', 'Quarterfinals', 'Semifinals', 'National Championship'], 6, TRUE, NOW(), NOW()
FROM "sports" s
WHERE s."sport" = 'AMERICAN_FOOTBALL'
ON CONFLICT ("sport_id", "name") DO UPDATE SET "round_names" = EXCLUDED."round_names", "tier_count" = EXCLUDED."tier_count";

-- The league's contest templates, scored by knockout round points: Doubling (1, 2, 4 and 8 points
-- for a win in each round; a bye scores nothing), with and without the seed-difference upset
-- bonus, for each selection type the sport has. The tiered one picks a team from each of the six
-- tiers and is the league's default. Contest creation refuses a preset for an event with another
-- round count.
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
  'cfp-' || preset."template_key",
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
    'Pick one team from each of the six tiers. A win scores 1 point in the First Round, 2 in the Quarterfinals, 4 in the Semifinals and 8 in the National Championship.',
    1,
    TRUE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 6, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'TIERED',
    'tiered-doubling-upset-bonus',
    'Pick 1 team from each tier, Doubling + upset bonus',
    'Pick one team from each of the six tiers. A win scores 1 point in the First Round, 2 in the Quarterfinals, 4 in the Semifinals and 8 in the National Championship, and a win over a better seed adds the seed difference.',
    2,
    FALSE,
    '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 6, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling',
    'Pick 4 teams under the cap, Doubling',
    'Pick four teams whose prices fit under the salary cap. A win scores 1 point in the First Round, 2 in the Quarterfinals, 4 in the Semifinals and 8 in the National Championship.',
    3,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'BUDGET_PICK',
    'budget-doubling-upset-bonus',
    'Pick 4 teams under the cap, Doubling + upset bonus',
    'Pick four teams whose prices fit under the salary cap. A win scores 1 point in the First Round, 2 in the Quarterfinals, 4 in the Semifinals and 8 in the National Championship, and a win over a better seed adds the seed difference.',
    4,
    FALSE,
    '{ "selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling',
    'Draw 1 team each, Doubling',
    'The playoff sweep: the draw deals every entry one team at random. A win scores 1 point in the First Round, 2 in the Quarterfinals, 4 in the Semifinals and 8 in the National Championship.',
    5,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "NONE" } } } }'
  ),
  (
    'RANDOM_DRAW',
    'random-draw-doubling-upset-bonus',
    'Draw 1 team each, Doubling + upset bonus',
    'The playoff sweep: the draw deals every entry one team at random. A win scores 1 point in the First Round, 2 in the Quarterfinals, 4 in the Semifinals and 8 in the National Championship, and a win over a better seed adds the seed difference.',
    6,
    FALSE,
    '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": { "roundValues": [1, 2, 4, 8], "upsetBonus": { "rule": "SEED_DIFFERENCE", "multiplier": 1 } } } }'
  )
) AS preset("selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'AMERICAN_FOOTBALL'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = 'College Football Playoff';
