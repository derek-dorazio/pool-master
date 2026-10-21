-- #787: league seasons and group matchdays. A Premier League matchweek, and a matchday of a
-- tournament's group stage (or the Champions League's league phase), is a week event: an event of
-- one round whose matches form no bracket, as an NFL regular-season week is. A week offers pick'em
-- (draw picks included, as soccer allows them) and, in the Premier League, survivor ("Last Man
-- Standing"), whose teams can be picked again once an entry has used all 20. Group matchdays offer
-- pick'em only. Idempotent on the (sport_id, name) unique: an admin who already created the league
-- keeps their row.
INSERT INTO "sport_leagues" ("id", "sport_id", "name", "bracket_advancement", "round_names", "squares_from_round", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", 'Premier League', 'FIXED', ARRAY[]::text[], NULL, TRUE, NOW(), NOW()
FROM "sports" s
WHERE s."sport" = 'SOCCER'
ON CONFLICT ("sport_id", "name") DO NOTHING;

-- The week templates (`rules/ux-rules.md` §12): pick'em straight up is each league's default, and
-- Last Man Standing the Premier League's survivor default.
INSERT INTO "contest_config_templates" (
  "id", "sport", "sport_league_id", "event_type", "contest_type", "selection_type", "template_key",
  "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at"
)
SELECT
  gen_random_uuid(), 'SOCCER', l."id", 'WEEK', 'PREDICTION', preset."selection_type"::"PrismaSelectionType",
  preset."template_key", preset."name", preset."description", preset."sort_order", preset."is_default", TRUE,
  preset."config_json"::jsonb, 1, NOW()
FROM (VALUES
  ('Premier League', 'PICK_EM', 'premier-league-pick-em-straight-up', 'Pick’em: every match, straight up', 'Pick the winner of every match each week, or a draw. Each right pick scores a point.', 1, TRUE, '{"selectionType": "PICK_EM", "mode": "STRAIGHT_UP", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('Premier League', 'PICK_EM', 'premier-league-pick-em-confidence', 'Pick’em: every match, confidence points', 'Pick the winner of every match each week, or a draw, then rank your picks by confidence. A right pick scores the value you gave it.', 2, FALSE, '{"selectionType": "PICK_EM", "mode": "CONFIDENCE", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('Premier League', 'SURVIVOR', 'premier-league-survivor', 'Survivor: Last Man Standing, 1 team a week', 'Pick one team to win each week, never the same team twice until you have picked all 20. A loss or a draw puts the entry out; the last ones standing win.', 3, TRUE, '{"selectionType": "SURVIVOR", "reuseTeamsOnceAllUsed": true, "maxEntriesPerSquad": 1}'),
  ('FIFA World Cup', 'PICK_EM', 'world-cup-matchday-pick-em-straight-up', 'Pick’em: every match, straight up', 'Pick the winner of every match of the matchday, or a draw. Each right pick scores a point.', 1, TRUE, '{"selectionType": "PICK_EM", "mode": "STRAIGHT_UP", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('FIFA World Cup', 'PICK_EM', 'world-cup-matchday-pick-em-confidence', 'Pick’em: every match, confidence points', 'Pick the winner of every match of the matchday, or a draw, then rank your picks by confidence. A right pick scores the value you gave it.', 2, FALSE, '{"selectionType": "PICK_EM", "mode": "CONFIDENCE", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('FIFA Women''s World Cup', 'PICK_EM', 'womens-world-cup-matchday-pick-em-straight-up', 'Pick’em: every match, straight up', 'Pick the winner of every match of the matchday, or a draw. Each right pick scores a point.', 1, TRUE, '{"selectionType": "PICK_EM", "mode": "STRAIGHT_UP", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('FIFA Women''s World Cup', 'PICK_EM', 'womens-world-cup-matchday-pick-em-confidence', 'Pick’em: every match, confidence points', 'Pick the winner of every match of the matchday, or a draw, then rank your picks by confidence. A right pick scores the value you gave it.', 2, FALSE, '{"selectionType": "PICK_EM", "mode": "CONFIDENCE", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('UEFA European Championship', 'PICK_EM', 'euro-matchday-pick-em-straight-up', 'Pick’em: every match, straight up', 'Pick the winner of every match of the matchday, or a draw. Each right pick scores a point.', 1, TRUE, '{"selectionType": "PICK_EM", "mode": "STRAIGHT_UP", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('UEFA European Championship', 'PICK_EM', 'euro-matchday-pick-em-confidence', 'Pick’em: every match, confidence points', 'Pick the winner of every match of the matchday, or a draw, then rank your picks by confidence. A right pick scores the value you gave it.', 2, FALSE, '{"selectionType": "PICK_EM", "mode": "CONFIDENCE", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('Copa América', 'PICK_EM', 'copa-america-matchday-pick-em-straight-up', 'Pick’em: every match, straight up', 'Pick the winner of every match of the matchday, or a draw. Each right pick scores a point.', 1, TRUE, '{"selectionType": "PICK_EM", "mode": "STRAIGHT_UP", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('Copa América', 'PICK_EM', 'copa-america-matchday-pick-em-confidence', 'Pick’em: every match, confidence points', 'Pick the winner of every match of the matchday, or a draw, then rank your picks by confidence. A right pick scores the value you gave it.', 2, FALSE, '{"selectionType": "PICK_EM", "mode": "CONFIDENCE", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('UEFA Champions League', 'PICK_EM', 'champions-league-matchday-pick-em-straight-up', 'Pick’em: every match, straight up', 'Pick the winner of every match of the matchday, or a draw. Each right pick scores a point.', 1, TRUE, '{"selectionType": "PICK_EM", "mode": "STRAIGHT_UP", "againstTheSpread": false, "maxEntriesPerSquad": 1}'),
  ('UEFA Champions League', 'PICK_EM', 'champions-league-matchday-pick-em-confidence', 'Pick’em: every match, confidence points', 'Pick the winner of every match of the matchday, or a draw, then rank your picks by confidence. A right pick scores the value you gave it.', 2, FALSE, '{"selectionType": "PICK_EM", "mode": "CONFIDENCE", "againstTheSpread": false, "maxEntriesPerSquad": 1}')
) AS preset("league", "selection_type", "template_key", "name", "description", "sort_order", "is_default", "config_json")
JOIN "sports" s ON s."sport" = 'SOCCER'
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset."league"
ON CONFLICT ("sport", "event_type", "contest_type", "selection_type", "template_key") DO NOTHING;
