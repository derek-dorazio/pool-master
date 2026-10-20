-- Squares on college games (#785, #786). Men's college basketball plays two halves; every other
-- league keeps its sport's quarters. A separate migration from the enum it uses, which Postgres
-- cannot use in the transaction that adds it.
UPDATE "sport_leagues" l
SET "match_period_layout" = 'HALVES', "updated_at" = NOW()
FROM "sports" s
WHERE s."id" = l."sport_id" AND s."sport" = 'BASKETBALL' AND l."name" = 'NCAA Division I Men';

-- Each league's squares pool preset, as the NFL's (#711): ten boxes per squad, one entry per squad,
-- the default for its league's squares contests. NBA and WNBA playoff games are played as series,
-- one match each, so they take no squares preset.
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
  s."sport",
  l."id",
  NULL,
  'SQUARES',
  'SQUARES',
  preset.template_key,
  'Squares: 10 boxes each',
  preset.description,
  10,
  TRUE,
  TRUE,
  '{ "selectionType": "SQUARES", "maxSquaresPerEntry": 10, "maxEntriesPerSquad": 1 }'::jsonb,
  1,
  NOW()
FROM (VALUES
  ('AMERICAN_FOOTBALL', 'College Football Playoff', 'cfp-squares',
   'A 10x10 grid on one game, the National Championship first. Each entry claims up to 10 boxes; then the digits 0 to 9 are drawn along each side. The box matching the last digit of each team''s score wins at the end of the first quarter, at halftime, at the end of the third quarter and at the final score.'),
  ('BASKETBALL', 'NCAA Division I Men', 'ncaa-men-squares',
   'A 10x10 grid on one game, the National Championship first. Each entry claims up to 10 boxes; then the digits 0 to 9 are drawn along each side. The box matching the last digit of each team''s score wins at halftime and at the final score.'),
  ('BASKETBALL', 'NCAA Division I Women', 'ncaa-women-squares',
   'A 10x10 grid on one game, the National Championship first. Each entry claims up to 10 boxes; then the digits 0 to 9 are drawn along each side. The box matching the last digit of each team''s score wins at the end of the first quarter, at halftime, at the end of the third quarter and at the final score.')
) AS preset(sport, league_name, template_key, description)
JOIN "sports" s ON s."sport"::text = preset.sport
JOIN "sport_leagues" l ON l."sport_id" = s."id" AND l."name" = preset.league_name
ON CONFLICT ("sport", "event_type", "contest_type", "selection_type", "template_key") DO NOTHING;
