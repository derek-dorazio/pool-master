-- #704: golf's "Top four tiers" setup, the variation beside golf's default tiered setup. A tiered
-- contest may now pick from only the event's first tiers (`tiersUsed` in its rules): one golfer
-- from each of the first four, all four count. Tiers stay on the event and are shared by every
-- contest on it (#249), so this is a contest rule, not a second tier layout.
--
-- Golf's templates are sport-wide (no sport league, no event type), so the template sorts right
-- after the two-per-tier variation, and golf's budget and random-draw setups move down one.
UPDATE "contest_config_templates"
SET "sort_order" = "sort_order" + 1, "updated_at" = NOW()
WHERE "sport" = 'GOLF' AND "sport_league_id" IS NULL AND "sort_order" >= 3;

INSERT INTO "contest_config_templates" (
  "id", "sport", "sport_league_id", "event_type", "contest_type", "selection_type", "template_key",
  "name", "description", "sort_order", "is_default", "active", "config_json", "schema_version", "updated_at"
)
SELECT
  gen_random_uuid(), 'GOLF', NULL, NULL, 'ROSTER', 'TIERED', 'golf-tiered-top-four-tiers',
  'Tiered: 1 golfer from each of the top 4 tiers, all count',
  'Pick one golfer from each of the field''s first four tiers, the strongest golfers. All four golfers'' scores count.',
  3, FALSE, TRUE,
  '{"selectionType": "TIERED", "picksPerTier": 1, "tiersUsed": 4, "countedScores": 4, "maxEntriesPerSquad": 1}'::jsonb, 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "contest_config_templates" WHERE "template_key" = 'golf-tiered-top-four-tiers');
