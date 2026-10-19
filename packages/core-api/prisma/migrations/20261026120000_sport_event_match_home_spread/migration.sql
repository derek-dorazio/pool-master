-- A pick'em game's points spread from the home side (#720): null until set, half points at most.
ALTER TABLE "sport_event_matches" ADD COLUMN "home_spread" DECIMAL(4,1);

ALTER TABLE "sport_event_matches"
  ADD CONSTRAINT "sport_event_matches_home_spread_half_points_check"
  CHECK ("home_spread" IS NULL OR "home_spread" * 2 = TRUNC("home_spread" * 2));

-- Pick'em rules now say whether picks are scored against the spread: every pick'em contest and
-- template made before it was straight up.
UPDATE "contest_configurations"
  SET "config_json" = "config_json" || '{"againstTheSpread": false}'::jsonb
  WHERE "config_json"->>'selectionType' = 'PICK_EM' AND NOT ("config_json" ? 'againstTheSpread');

UPDATE "contest_config_templates"
  SET "config_json" = "config_json" || '{"againstTheSpread": false}'::jsonb
  WHERE "config_json"->>'selectionType' = 'PICK_EM' AND NOT ("config_json" ? 'againstTheSpread');
