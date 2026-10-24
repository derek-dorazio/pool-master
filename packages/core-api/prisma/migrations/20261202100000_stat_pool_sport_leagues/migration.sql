-- #935: the championship stat pools' sport leagues and their contest templates
-- (`plans/championship-stat-pools.md` §3), a separate migration from the one that adds the
-- COMPOSITE scoring family and the override columns.
--
-- One sport league per championship, named for the event, under its sport: its field is players,
-- not teams, and it is scored by the composite family, each game a player's sport composite (Box
-- Score for baseball). Each holds one event a season; the NFL's are two events, Conference
-- Championship weekend and the Super Bowl. Idempotent on the (sport_id, name) unique: an admin
-- who already created a league keeps their row, with its overrides set.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "bracket_advancement", "participant_type", "scoring_family", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", 'FIXED', 'INDIVIDUAL', 'COMPOSITE', TRUE, NOW(), NOW()
FROM "sports" s
JOIN (VALUES
  ('BASEBALL', 'World Series'),
  ('BASKETBALL', 'NBA Finals'),
  ('HOCKEY', 'Stanley Cup Final'),
  ('AMERICAN_FOOTBALL', 'Championship Weekend'),
  ('AMERICAN_FOOTBALL', 'Super Bowl')
) AS league("sport", "name") ON s."sport"::text = league."sport"
ON CONFLICT ("sport_id", "name") DO UPDATE SET "participant_type" = EXCLUDED."participant_type", "scoring_family" = EXCLUDED."scoring_family";

-- Each league's templates, named and defaulted as `rules/ux-rules.md` §12 says: one default per
-- roster format, Tiered first (six tiers, best four count), then Budget (six players, best four)
-- and Quick pick (three players, all count). Every one scores the composite total, which takes no
-- settings: the sport fixes the formula. Golf's shape, so no kind of event is named.
INSERT INTO "contest_config_templates" (
  "id", "sport", "sport_league_id", "event_type", "contest_type", "selection_type", "template_key",
  "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at"
)
SELECT
  gen_random_uuid(), preset."sport"::"PrismaSport", l."id", NULL, 'ROSTER', preset."selection_type"::"PrismaSelectionType",
  preset."template_key", preset."name", preset."description", preset."sort_order", TRUE, TRUE, preset."config_json"::jsonb, 1, NOW()
FROM (VALUES
  ('BASEBALL', 'World Series', 'TIERED', 'world-series-tiered-box-score', 'Tiered: 1 player per tier, best 4 count', 'Pick one player from each of the six tiers, and your best four count. Each game a player scores their Box Score: total bases + runs + RBI + walks + stolen bases.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('BASEBALL', 'World Series', 'BUDGET_PICK', 'world-series-budget-box-score', 'Budget: 6 players under the cap, best 4 count', 'Pick six players whose prices fit under the salary cap, and your best four count. Each game a player scores their Box Score: total bases + runs + RBI + walks + stolen bases.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('BASEBALL', 'World Series', 'RANDOM_DRAW', 'world-series-quick-pick-box-score', 'Quick pick: 3 players each, all count', 'The draw deals each entry three players at random, and all three count. Each game a player scores their Box Score: total bases + runs + RBI + walks + stolen bases.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('BASKETBALL', 'NBA Finals', 'TIERED', 'nba-finals-tiered-triple-threat', 'Tiered: 1 player per tier, best 4 count', 'Pick one player from each of the six tiers, and your best four count. Each game a player scores their Triple Threat: points + rebounds + assists.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('BASKETBALL', 'NBA Finals', 'BUDGET_PICK', 'nba-finals-budget-triple-threat', 'Budget: 6 players under the cap, best 4 count', 'Pick six players whose prices fit under the salary cap, and your best four count. Each game a player scores their Triple Threat: points + rebounds + assists.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('BASKETBALL', 'NBA Finals', 'RANDOM_DRAW', 'nba-finals-quick-pick-triple-threat', 'Quick pick: 3 players each, all count', 'The draw deals each entry three players at random, and all three count. Each game a player scores their Triple Threat: points + rebounds + assists.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('HOCKEY', 'Stanley Cup Final', 'TIERED', 'stanley-cup-final-tiered-power-play', 'Tiered: 1 player per tier, best 4 count', 'Pick one player from each of the six tiers, and your best four count. Each game a player scores their Power Play: 2 per goal + assists + shots on goal.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('HOCKEY', 'Stanley Cup Final', 'BUDGET_PICK', 'stanley-cup-final-budget-power-play', 'Budget: 6 players under the cap, best 4 count', 'Pick six players whose prices fit under the salary cap, and your best four count. Each game a player scores their Power Play: 2 per goal + assists + shots on goal.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('HOCKEY', 'Stanley Cup Final', 'RANDOM_DRAW', 'stanley-cup-final-quick-pick-power-play', 'Quick pick: 3 players each, all count', 'The draw deals each entry three players at random, and all three count. Each game a player scores their Power Play: 2 per goal + assists + shots on goal.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'Championship Weekend', 'TIERED', 'championship-weekend-tiered-redzone', 'Tiered: 1 player per tier, best 4 count', 'Pick one player from each of the six tiers, and your best four count. Each game a player scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'Championship Weekend', 'BUDGET_PICK', 'championship-weekend-budget-redzone', 'Budget: 6 players under the cap, best 4 count', 'Pick six players whose prices fit under the salary cap, and your best four count. Each game a player scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'Championship Weekend', 'RANDOM_DRAW', 'championship-weekend-quick-pick-redzone', 'Quick pick: 3 players each, all count', 'The draw deals each entry three players at random, and all three count. Each game a player scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'Super Bowl', 'TIERED', 'super-bowl-tiered-redzone', 'Tiered: 1 player per tier, best 4 count', 'Pick one player from each of the six tiers, and your best four count. Each game a player scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'Super Bowl', 'BUDGET_PICK', 'super-bowl-budget-redzone', 'Budget: 6 players under the cap, best 4 count', 'Pick six players whose prices fit under the salary cap, and your best four count. Each game a player scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'Super Bowl', 'RANDOM_DRAW', 'super-bowl-quick-pick-redzone', 'Quick pick: 3 players each, all count', 'The draw deals each entry three players at random, and all three count. Each game a player scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}')
) AS preset("sport", "league", "selection_type", "template_key", "name", "description", "sort_order", "config_json")
JOIN "sports" s ON s."sport"::text = preset."sport"
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset."league"
WHERE NOT EXISTS (SELECT 1 FROM "contest_config_templates" t WHERE t."template_key" = preset."template_key");
