-- #991: the College Football Playoff's Clutch Cards, two sport leagues of players under American
-- football as the NFL's are: the semifinals (one game for each of the four teams) and the National
-- Championship. The bracket league "College Football Playoff" keeps its name. Both score Redzone, the
-- sport's composite, and sort after the NFL's stat pools. Idempotent on the (sport_id, name) unique,
-- as 20261207100000_stat_pool_sport_leagues is.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "bracket_advancement", "participant_type", "scoring_family", "display_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", 'FIXED', 'INDIVIDUAL', 'COMPOSITE', league."display_order", TRUE, NOW(), NOW()
FROM "sports" s
JOIN (VALUES
  ('AMERICAN_FOOTBALL', 'CFP Semifinals', 50),
  ('AMERICAN_FOOTBALL', 'CFP National Championship', 60)
) AS league("sport", "name", "display_order") ON s."sport"::text = league."sport"
ON CONFLICT ("sport_id", "name") DO UPDATE SET "participant_type" = EXCLUDED."participant_type", "scoring_family" = EXCLUDED."scoring_family", "display_order" = EXCLUDED."display_order";

-- Each league's three setups, as the NFL's stat pools have: Tiered first (six tiers, best four
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
  ('AMERICAN_FOOTBALL', 'CFP Semifinals', 'TIERED', 'cfp-semifinals-tiered-redzone', 'Tiered: 1 star per tier, best 4 count', 'Pick one star from each of the six tiers, and your best four count. Each game a star scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'CFP Semifinals', 'BUDGET_PICK', 'cfp-semifinals-budget-redzone', 'Budget: 6 stars under the cap, best 4 count', 'Pick six stars whose prices fit under the salary cap, and your best four count. Each game a star scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'CFP Semifinals', 'RANDOM_DRAW', 'cfp-semifinals-quick-pick-redzone', 'Quick pick: 3 stars each, all count', 'The draw deals each entry three stars at random, and all three count. Each game a star scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'CFP National Championship', 'TIERED', 'cfp-national-championship-tiered-redzone', 'Tiered: 1 star per tier, best 4 count', 'Pick one star from each of the six tiers, and your best four count. Each game a star scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'CFP National Championship', 'BUDGET_PICK', 'cfp-national-championship-budget-redzone', 'Budget: 6 stars under the cap, best 4 count', 'Pick six stars whose prices fit under the salary cap, and your best four count. Each game a star scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('AMERICAN_FOOTBALL', 'CFP National Championship', 'RANDOM_DRAW', 'cfp-national-championship-quick-pick-redzone', 'Quick pick: 3 stars each, all count', 'The draw deals each entry three stars at random, and all three count. Each game a star scores their Redzone: 6 per touchdown + receptions + 1 per 10 yards.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}')
) AS preset("sport", "league", "selection_type", "template_key", "name", "description", "sort_order", "config_json")
JOIN "sports" s ON s."sport"::text = preset."sport"
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset."league"
WHERE NOT EXISTS (SELECT 1 FROM "contest_config_templates" t WHERE t."template_key" = preset."template_key");
