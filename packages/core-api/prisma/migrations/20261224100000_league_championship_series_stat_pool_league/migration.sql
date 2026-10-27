-- #1048: the League Championship Series' Clutch Card, a sport league of players under baseball for
-- the round before the World Series. The ALCS and the NLCS are one event, as both conference finals
-- are in basketball and hockey; each round is its own league. Scores Box Score, the sport's
-- composite, and sorts between MLB and the World Series. Idempotent on the (sport_id, name) unique,
-- as 20261207100000_stat_pool_sport_leagues is.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "bracket_advancement", "participant_type", "scoring_family", "display_order", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", 'FIXED', 'INDIVIDUAL', 'COMPOSITE', league."display_order", TRUE, NOW(), NOW()
FROM "sports" s
JOIN (VALUES
  ('BASEBALL', 'League Championship Series', 15)
) AS league("sport", "name", "display_order") ON s."sport"::text = league."sport"
ON CONFLICT ("sport_id", "name") DO UPDATE SET "participant_type" = EXCLUDED."participant_type", "scoring_family" = EXCLUDED."scoring_family", "display_order" = EXCLUDED."display_order";

-- The league's three setups, as the World Series has: Tiered first (six tiers, best four
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
  ('BASEBALL', 'League Championship Series', 'TIERED', 'league-championship-series-tiered-box-score', 'Tiered: 1 star per tier, best 4 count', 'Pick one star from each of the six tiers, and your best four count. Each game a star scores their Box Score: total bases + runs + RBI + walks + stolen bases.', 1, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('BASEBALL', 'League Championship Series', 'BUDGET_PICK', 'league-championship-series-budget-box-score', 'Budget: 6 stars under the cap, best 4 count', 'Pick six stars whose prices fit under the salary cap, and your best four count. Each game a star scores their Box Score: total bases + runs + RBI + walks + stolen bases.', 2, '{"selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}'),
  ('BASEBALL', 'League Championship Series', 'RANDOM_DRAW', 'league-championship-series-quick-pick-box-score', 'Quick pick: 3 stars each, all count', 'The draw deals each entry three stars at random, and all three count. Each game a star scores their Box Score: total bases + runs + RBI + walks + stolen bases.', 3, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "COMPOSITE_TOTAL", "config": {}}}')
) AS preset("sport", "league", "selection_type", "template_key", "name", "description", "sort_order", "config_json")
JOIN "sports" s ON s."sport"::text = preset."sport"
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset."league"
WHERE NOT EXISTS (SELECT 1 FROM "contest_config_templates" t WHERE t."template_key" = preset."template_key");
