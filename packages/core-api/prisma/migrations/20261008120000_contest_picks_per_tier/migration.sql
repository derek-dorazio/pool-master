-- #479: a tiered contest's commissioner sets picks per tier, not a roster size.
--
-- The event owns its tiers; every tier now takes the same number of picks, and that number
-- belongs to the contest. An entry's total picks is the event's tier count times the
-- contest's picksPerTier, derived on read and never stored. So:
--   * contest config_json { rosterSize, countedScores } becomes { picksPerTier, countedScores };
--   * the roster_size / pick_count copies on tiered configurations are cleared;
--   * sport_event_tiers.default_pick_count is dropped (uneven picks per tier is retired).

-- Each contest's event tier count. The old create check guaranteed rosterSize divides evenly
-- across the tiers; it was skipped when the event had no tiers yet, and 1 per tier is the
-- reading for those.
CREATE TEMP TABLE "contest_tier_counts" AS
SELECT c."id" AS "contest_id", COUNT(t."id")::int AS "tier_count"
FROM "contests" c
LEFT JOIN "sport_event_tiers" t ON t."sport_event_id" = c."sport_event_id"
GROUP BY c."id";

UPDATE "contest_configurations" cc
SET "config_json" = (cc."config_json" - 'rosterSize') || jsonb_build_object(
  'picksPerTier',
  CASE
    WHEN tc."tier_count" > 0 THEN GREATEST(1, (cc."config_json"->>'rosterSize')::int / tc."tier_count")
    ELSE 1
  END
)
FROM "contest_tier_counts" tc
WHERE tc."contest_id" = cc."contest_id"
  AND jsonb_typeof(cc."config_json") = 'object'
  AND cc."config_json" ? 'rosterSize';

-- Tiered configurations saved before the typed config_json existed carried only the columns.
-- Read paths used to synthesize { rosterSize, countedScores } from them; write it down instead.
UPDATE "contest_configurations" cc
SET "config_json" = jsonb_build_object(
  'picksPerTier',
  CASE
    WHEN tc."tier_count" > 0
      THEN GREATEST(1, COALESCE(cc."roster_size", cc."pick_count", tc."tier_count") / tc."tier_count")
    ELSE 1
  END,
  'countedScores',
  LEAST(COALESCE(cc."roster_size", cc."pick_count", 4), 4)
)
FROM "contest_tier_counts" tc
WHERE tc."contest_id" = cc."contest_id"
  AND cc."selection_type" = 'TIERED'
  AND (cc."config_json" IS NULL OR jsonb_typeof(cc."config_json") <> 'object');

UPDATE "contest_configurations"
SET "roster_size" = NULL, "pick_count" = NULL
WHERE "selection_type" = 'TIERED';

DROP TABLE "contest_tier_counts";

-- The two seeded tiered presets: one per tier with 4 counting, and two per tier with 8.
UPDATE "contest_config_templates"
SET "config_json" = ("config_json" - 'rosterSize') || '{ "picksPerTier": 1, "countedScores": 4 }'::jsonb
WHERE "template_key" = 'golf-tiered-pick-6' AND "selection_type" = 'TIERED';

UPDATE "contest_config_templates"
SET "config_json" = ("config_json" - 'rosterSize') || '{ "picksPerTier": 2, "countedScores": 8 }'::jsonb
WHERE "template_key" = 'golf-tiered-pick-12' AND "selection_type" = 'TIERED';

-- Any other tiered template has no event to divide across; it starts at one per tier.
UPDATE "contest_config_templates"
SET "config_json" = ("config_json" - 'rosterSize') || '{ "picksPerTier": 1 }'::jsonb
WHERE "selection_type" = 'TIERED' AND "config_json" ? 'rosterSize';

-- AlterTable
ALTER TABLE "sport_event_tiers" DROP COLUMN "default_pick_count";
