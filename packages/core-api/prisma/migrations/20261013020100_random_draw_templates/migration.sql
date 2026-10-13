-- #601: the two golf random-draw (sweepstake) presets. A separate migration from the one that
-- adds RANDOM_DRAW to "PrismaSelectionType", because a new enum value cannot be used in the
-- transaction that added it. Neither is the default: that stays the tiered preset.
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
  '55555555-5555-4555-8555-555555555555',
  'GOLF',
  NULL,
  'ROSTER',
  'RANDOM_DRAW',
  'golf-random-draw-1',
  'Draw 1 golfer each',
  'The classic sweepstake: the draw deals every entry one golfer at random. The entry scores its golfer''s score.',
  5,
  FALSE,
  TRUE,
  '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1 }'::jsonb,
  1,
  NOW()
),
(
  '66666666-6666-4666-8666-666666666666',
  'GOLF',
  NULL,
  'ROSTER',
  'RANDOM_DRAW',
  'golf-random-draw-3-best-2',
  'Draw 3 golfers each, 2 count',
  'The draw deals every entry three golfers at random. The best two scores count for the entry total.',
  6,
  FALSE,
  TRUE,
  '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 3, "countedScores": 2, "maxEntriesPerSquad": 1 }'::jsonb,
  1,
  NOW()
);
