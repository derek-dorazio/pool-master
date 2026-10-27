-- #994: soccer's first Clutch Cards, scored on Hat Trick, four sport leagues of outfield players,
-- one per knockout round as the College Football Playoff's are: the UEFA Champions League's
-- semifinals (both legs of both ties, game 1 the first legs) and final, and the FIFA Women's World
-- Cup's semifinals and final. The bracket leagues "UEFA Champions League" and "FIFA Women's World
-- Cup" keep their names. They sort after every soccer bracket league. Idempotent on the
-- (sport_id, name) unique, as 20261207100000_stat_pool_sport_leagues is. Shots on target are a
-- stat value of their own, added by 20261226100000_sport_stat_shots_on_target.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "bracket_advancement", "participant_type", "scoring_family", "display_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", 'FIXED', 'INDIVIDUAL', 'COMPOSITE', league."display_order", TRUE, NOW(), NOW()
FROM "sports" s
JOIN (VALUES
  ('SOCCER', 'Champions League Semifinals', 110),
  ('SOCCER', 'Champions League Final', 120),
  ('SOCCER', 'Women''s World Cup Semifinals', 130),
  ('SOCCER', 'Women''s World Cup Final', 140)
) AS league("sport", "name", "display_order") ON s."sport"::text = league."sport"
ON CONFLICT ("sport_id", "name") DO UPDATE SET "participant_type" = EXCLUDED."participant_type", "scoring_family" = EXCLUDED."scoring_family", "display_order" = EXCLUDED."display_order";

-- Each league's three setups, as every stat pool league has: Tiered first (six tiers, best four
-- count), then Budget (six stars, best four) and Quick pick (three stars, all count), each the
-- default of its format and scored by the composite total.
INSERT INTO "contest_config_templates" (
  "id", "sport", "sport_league_id", "event_type", "contest_type", "selection_type", "template_key",
  "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at"
)
SELECT
  gen_random_uuid(), preset."sport"::"PrismaSport", l."id", NULL, 'ROSTER', preset."selection_type"::"PrismaSelectionType",
  preset."template_key", preset."name", preset."description", preset."sort_order", TRUE, TRUE, preset."config_json"::jsonb, 1, NOW()
FROM (VALUES
  ('SOCCER', 'Champions League Semifinals', 'TIERED', 'champions-league-semifinals-tiered-hat-trick', 'Tiered: 1 star per tier, best 4 count', 'Pick one star from each of the six tiers, and your best four count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Champions League Semifinals', 'BUDGET_PICK', 'champions-league-semifinals-budget-hat-trick', 'Budget: 6 stars under the cap, best 4 count', 'Pick six stars whose prices fit under the salary cap, and your best four count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Champions League Semifinals', 'RANDOM_DRAW', 'champions-league-semifinals-quick-pick-hat-trick', 'Quick pick: 3 stars each, all count', 'The draw deals each entry three stars at random, and all three count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Champions League Final', 'TIERED', 'champions-league-final-tiered-hat-trick', 'Tiered: 1 star per tier, best 4 count', 'Pick one star from each of the six tiers, and your best four count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Champions League Final', 'BUDGET_PICK', 'champions-league-final-budget-hat-trick', 'Budget: 6 stars under the cap, best 4 count', 'Pick six stars whose prices fit under the salary cap, and your best four count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Champions League Final', 'RANDOM_DRAW', 'champions-league-final-quick-pick-hat-trick', 'Quick pick: 3 stars each, all count', 'The draw deals each entry three stars at random, and all three count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Women''s World Cup Semifinals', 'TIERED', 'womens-world-cup-semifinals-tiered-hat-trick', 'Tiered: 1 star per tier, best 4 count', 'Pick one star from each of the six tiers, and your best four count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Women''s World Cup Semifinals', 'BUDGET_PICK', 'womens-world-cup-semifinals-budget-hat-trick', 'Budget: 6 stars under the cap, best 4 count', 'Pick six stars whose prices fit under the salary cap, and your best four count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Women''s World Cup Semifinals', 'RANDOM_DRAW', 'womens-world-cup-semifinals-quick-pick-hat-trick', 'Quick pick: 3 stars each, all count', 'The draw deals each entry three stars at random, and all three count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Women''s World Cup Final', 'TIERED', 'womens-world-cup-final-tiered-hat-trick', 'Tiered: 1 star per tier, best 4 count', 'Pick one star from each of the six tiers, and your best four count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Women''s World Cup Final', 'BUDGET_PICK', 'womens-world-cup-final-budget-hat-trick', 'Budget: 6 stars under the cap, best 4 count', 'Pick six stars whose prices fit under the salary cap, and your best four count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('SOCCER', 'Women''s World Cup Final', 'RANDOM_DRAW', 'womens-world-cup-final-quick-pick-hat-trick', 'Quick pick: 3 stars each, all count', 'The draw deals each entry three stars at random, and all three count. Each match a star scores their Hat Trick: 3 per goal + 2 per assist + shots on target.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}')
) AS preset("sport", "league", "selection_type", "template_key", "name", "description", "sort_order", "config_json")
JOIN "sports" s ON s."sport"::text = preset."sport"
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset."league"
WHERE NOT EXISTS (SELECT 1 FROM "contest_config_templates" t WHERE t."template_key" = preset."template_key");
