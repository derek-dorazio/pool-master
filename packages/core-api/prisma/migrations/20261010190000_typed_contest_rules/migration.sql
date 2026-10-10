-- #93: a contest's config_json holds its rules as one shape per selection type, tagged with
-- "selectionType" (the same value as the row's selection_type column).
--   TIERED      { selectionType, picksPerTier, countedScores }
--   BUDGET_PICK { selectionType, rosterSize, salaryCap, countedScores }
-- The legacy budget / roster_size / pick_count columns are no longer read; dropping them is a
-- follow-up. Templates hold the same rules plus "maxEntriesPerSquad", without a salary cap.

-- Tiered rows already hold their rules; they gain the tag. Keys saved before #416 (a lock time,
-- an entry cap) are dropped by reading, not here.
UPDATE "contest_configurations"
SET "config_json" = "config_json" || '{ "selectionType": "TIERED" }'::jsonb
WHERE "selection_type" = 'TIERED' AND jsonb_typeof("config_json") = 'object';

-- Budget rows (#198 built the room; nothing let a commissioner create one) are rebuilt from the
-- legacy columns: a roster of 1 to 12 (6 when unset), the event's cap when it is priced, else
-- the legacy budget, else the Standard $50,000; every score counts unless fewer were stored.
WITH "budget_rules" AS (
  SELECT
    cc."id",
    LEAST(12, GREATEST(1, COALESCE((cc."config_json"->>'rosterSize')::int, cc."roster_size", cc."pick_count", 6))) AS "roster_size",
    COALESCE((se."pricing_config"->>'salaryCap')::int, cc."budget", 50000) AS "salary_cap",
    (cc."config_json"->>'countedScores')::int AS "counted_scores"
  FROM "contest_configurations" cc
  JOIN "contests" c ON c."id" = cc."contest_id"
  LEFT JOIN "sport_events" se ON se."id" = c."sport_event_id"
  WHERE cc."selection_type" = 'BUDGET_PICK'
)
UPDATE "contest_configurations" cc
SET "config_json" = jsonb_build_object(
  'selectionType', 'BUDGET_PICK',
  'rosterSize', br."roster_size",
  'salaryCap', br."salary_cap",
  'countedScores', LEAST(br."roster_size", GREATEST(1, COALESCE(br."counted_scores", br."roster_size")))
)
FROM "budget_rules" br
WHERE br."id" = cc."id";

-- Every other selection type has no rules shape and no engine yet: nothing could read its JSON.
UPDATE "contest_configurations"
SET "config_json" = NULL
WHERE "selection_type" NOT IN ('TIERED', 'BUDGET_PICK') AND "config_json" IS NOT NULL;

UPDATE "contest_config_templates"
SET "config_json" = "config_json" || '{ "selectionType": "TIERED" }'::jsonb
WHERE "selection_type" = 'TIERED';

-- The two budget presets. Both pick six golfers under the event's cap; one counts all six, the
-- other the best four. Neither is the default: there is one default per sport and contest
-- format, and it stays the tiered one.
INSERT INTO "contest_config_templates" (
  "id",
  "sport",
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
) VALUES
(
  '33333333-3333-4333-8333-333333333333',
  'GOLF',
  NULL,
  'ROSTER',
  'BUDGET_PICK',
  'golf-budget-pick-6-all-count',
  'Pick 6 under the cap, all count',
  'Pick six golfers whose prices fit under the salary cap. All six scores count for the entry total.',
  3,
  FALSE,
  TRUE,
  '{ "selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 6, "maxEntriesPerSquad": 1 }'::jsonb,
  1,
  NOW()
),
(
  '44444444-4444-4444-8444-444444444444',
  'GOLF',
  NULL,
  'ROSTER',
  'BUDGET_PICK',
  'golf-budget-pick-6-best-4',
  'Pick 6 under the cap, 4 count',
  'Pick six golfers whose prices fit under the salary cap. The best four scores count for the entry total.',
  4,
  FALSE,
  TRUE,
  '{ "selectionType": "BUDGET_PICK", "rosterSize": 6, "countedScores": 4, "maxEntriesPerSquad": 1 }'::jsonb,
  1,
  NOW()
);
