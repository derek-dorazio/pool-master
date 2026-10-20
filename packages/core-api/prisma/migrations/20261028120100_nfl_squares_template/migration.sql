-- The NFL's squares pool preset (#711, design Q3.3): ten boxes per squad, one entry per squad.
-- A separate migration from the enum values it uses, which Postgres cannot use in the transaction
-- that adds them. The only squares template, so the default for its contest format.
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
  'SQUARES',
  'SQUARES',
  'nfl-squares',
  'Squares: 10 boxes each',
  'A 10x10 grid on one game, the Super Bowl first. Each entry claims up to 10 boxes; then the digits 0 to 9 are drawn along each side. The box matching the last digit of each team''s score wins at the end of the first quarter, at halftime, at the end of the third quarter and at the final score.',
  10,
  TRUE,
  TRUE,
  '{ "selectionType": "SQUARES", "maxSquaresPerEntry": 10, "maxEntriesPerSquad": 1 }'::jsonb,
  1,
  NOW()
FROM "sport_leagues" l
JOIN "sports" s ON s."id" = l."sport_id"
WHERE s."sport" = 'AMERICAN_FOOTBALL' AND l."name" = 'NFL'
ON CONFLICT ("sport", "event_type", "contest_type", "selection_type", "template_key") DO NOTHING;
