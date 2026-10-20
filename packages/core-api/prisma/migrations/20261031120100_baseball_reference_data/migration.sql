-- #789: baseball's reference data, a separate migration from the one that adds BASEBALL to the
-- sport enum: a new enum value cannot be used in the transaction that added it.
--
-- The sports row: a team competes, and an event is played as MATCHES. Idempotent on the `sport`
-- unique, as the other sports' rows are.
INSERT INTO "sports" ("id", "sport", "participant_type", "tournament_format", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'BASEBALL', 'TEAM', 'MATCHES', NOW(), NOW())
ON CONFLICT ("sport") DO NOTHING;

-- Its sport league, reference data because its contest templates name it. The MLB postseason is
-- a fixed bracket of series, each one bracket match whose scores are the games won. Its rounds
-- read the sport's names (Wild Card Series to World Series), so it stores none of its own.
-- Idempotent on the (sport_id, name) unique: an admin who already created the league keeps
-- their row.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "bracket_advancement", "round_names", "tier_count", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", league."name", 'FIXED', league."round_names", league."tier_count", TRUE, NOW(), NOW()
FROM "sports" s
CROSS JOIN (VALUES
  ('MLB', ARRAY[]::text[], NULL::int)
) AS league("name", "round_names", "tier_count")
WHERE s."sport" = 'BASEBALL'
ON CONFLICT ("sport_id", "name") DO UPDATE SET "round_names" = EXCLUDED."round_names", "tier_count" = EXCLUDED."tier_count";

-- The league's contest templates, named and defaulted as `rules/ux-rules.md` §12 says: one
-- default per format, ahead of its variations, all for a KNOCKOUT. Roster picks and brackets are
-- scored by knockout round points (Doubling, with and without the seed-difference upset bonus);
-- survivor scores by its own rules. There is no squares template: every round, the World Series
-- too, is a series rather than one game.
INSERT INTO "contest_config_templates" (
  "id", "sport", "sport_league_id", "event_type", "contest_type", "selection_type", "template_key",
  "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at"
)
SELECT
  gen_random_uuid(), 'BASEBALL', l."id", 'KNOCKOUT', preset."contest_type"::"PrismaContestFormat",
  preset."selection_type"::"PrismaSelectionType", preset."template_key", preset."name", preset."description",
  preset."sort_order", preset."is_default", TRUE, preset."config_json"::jsonb, 1, NOW()
FROM (VALUES
  ('MLB', 'TIERED', 'ROSTER', 'mlb-tiered-doubling', 'Tiered: 1 team per tier, doubling points', 'Pick one team from each of the four tiers. A series win scores 1 point in the Wild Card Series, doubling each round to 8 in the World Series.', 1, TRUE, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": {"roundValues": [1, 2, 4, 8], "upsetBonus": {"rule": "NONE"}}}}'),
  ('MLB', 'BUDGET_PICK', 'ROSTER', 'mlb-budget-doubling', 'Budget: 4 teams under the cap, doubling points', 'Every team has a price: pick four whose prices fit under the salary cap. A series win scores 1 point in the Wild Card Series, doubling each round to 8 in the World Series.', 3, TRUE, '{"selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": {"roundValues": [1, 2, 4, 8], "upsetBonus": {"rule": "NONE"}}}}'),
  ('MLB', 'RANDOM_DRAW', 'ROSTER', 'mlb-random-draw-doubling', 'Random draw: 1 team each, doubling points', 'The playoff sweep: the draw deals each entry one team at random. A series win scores 1 point in the Wild Card Series, doubling each round to 8 in the World Series.', 5, TRUE, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": {"roundValues": [1, 2, 4, 8], "upsetBonus": {"rule": "NONE"}}}}'),
  ('MLB', 'BRACKET', 'PREDICTION', 'mlb-bracket-doubling', 'Bracket: full bracket, doubling points', 'Pick the winner of every series to the World Series before the first one starts. A right pick scores 1 point in the Wild Card Series, doubling each round to 8 in the World Series.', 7, TRUE, '{"selectionType": "BRACKET", "startsAtRound": 1, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": {"roundValues": [1, 2, 4, 8], "upsetBonus": {"rule": "NONE"}}}}'),
  ('MLB', 'TIERED', 'ROSTER', 'mlb-tiered-doubling-upset-bonus', 'Tiered: 1 team per tier, doubling + upset bonus', 'Pick one team from each of the four tiers. A series win scores 1 point in the Wild Card Series, doubling each round to 8 in the World Series, plus the seed difference for an upset.', 2, FALSE, '{"selectionType": "TIERED", "picksPerTier": 1, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": {"roundValues": [1, 2, 4, 8], "upsetBonus": {"rule": "SEED_DIFFERENCE", "multiplier": 1}}}}'),
  ('MLB', 'BUDGET_PICK', 'ROSTER', 'mlb-budget-doubling-upset-bonus', 'Budget: 4 teams under the cap, doubling + upset bonus', 'Every team has a price: pick four whose prices fit under the salary cap. A series win scores 1 point in the Wild Card Series, doubling each round to 8 in the World Series, plus the seed difference for an upset.', 4, FALSE, '{"selectionType": "BUDGET_PICK", "rosterSize": 4, "countedScores": 4, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": {"roundValues": [1, 2, 4, 8], "upsetBonus": {"rule": "SEED_DIFFERENCE", "multiplier": 1}}}}'),
  ('MLB', 'RANDOM_DRAW', 'ROSTER', 'mlb-random-draw-doubling-upset-bonus', 'Random draw: 1 team each, doubling + upset bonus', 'The playoff sweep: the draw deals each entry one team at random. A series win scores 1 point in the Wild Card Series, doubling each round to 8 in the World Series, plus the seed difference for an upset.', 6, FALSE, '{"selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": {"roundValues": [1, 2, 4, 8], "upsetBonus": {"rule": "SEED_DIFFERENCE", "multiplier": 1}}}}'),
  ('MLB', 'BRACKET', 'PREDICTION', 'mlb-bracket-doubling-upset-bonus', 'Bracket: full bracket, doubling + upset bonus', 'Pick the winner of every series to the World Series before the first one starts. A right pick scores 1 point in the Wild Card Series, doubling each round to 8 in the World Series, plus the seed difference for an upset.', 8, FALSE, '{"selectionType": "BRACKET", "startsAtRound": 1, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": {"roundValues": [1, 2, 4, 8], "upsetBonus": {"rule": "SEED_DIFFERENCE", "multiplier": 1}}}}'),
  ('MLB', 'BRACKET', 'PREDICTION', 'mlb-bracket-second-chance-doubling', 'Bracket: second chance, doubling points', 'A fresh bracket once the Wild Card Series are played: pick every series from the Division Series on. A right pick scores its round''s points, doubling each round.', 9, FALSE, '{"selectionType": "BRACKET", "startsAtRound": 2, "maxEntriesPerSquad": 1, "scoring": {"participantScoringDefinitionId": "KNOCKOUT_ROUND_POINTS", "config": {"roundValues": [1, 2, 4, 8], "upsetBonus": {"rule": "NONE"}}}}'),
  ('MLB', 'SURVIVOR', 'PREDICTION', 'mlb-playoff-survivor', 'Survivor: 1 team a round, each team once', 'Pick one team to win in each round, never the same team twice. A loss puts the entry out; the last ones standing win.', 11, TRUE, '{"selectionType": "SURVIVOR", "maxEntriesPerSquad": 1}')
) AS preset("league", "selection_type", "contest_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'BASEBALL'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset."league"
ON CONFLICT ("sport", "event_type", "contest_type", "selection_type", "template_key") DO NOTHING;
