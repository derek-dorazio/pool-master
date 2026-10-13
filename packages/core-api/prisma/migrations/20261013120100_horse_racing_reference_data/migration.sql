-- #623: horse racing's reference data. A separate migration from the one that adds HORSE_RACING
-- and RACE to their enums, because a new enum value cannot be used in the transaction that
-- added it.
--
-- The sports row: a horse is an individual competitor, and a horse race is a RACE (one field, one
-- finishing order). Idempotent on the `sport` unique, as golf's row is.
INSERT INTO "sports" ("id", "sport", "participant_type", "tournament_format", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'HORSE_RACING', 'INDIVIDUAL', 'RACE', NOW(), NOW())
ON CONFLICT ("sport") DO NOTHING;

-- Three presets, one per selection type horse racing offers, each scored Win / Place / Show: 5
-- points for the winner, 3 for second, 1 for third, and 0 for any other place and for a horse
-- that did not finish, was disqualified or did not start (plans/racing-sports.md §1.3). The
-- preset rides in the template's "scoring" key and is copied onto a contest created from it as
-- its participant scoring rule's settings. The tiered one is the default, as golf's is.
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
  '77777777-7777-4777-8777-777777777777',
  'HORSE_RACING',
  NULL,
  'ROSTER',
  'TIERED',
  'horse-racing-tiered-win-place-show',
  'Pick 1 horse from each tier, Win / Place / Show',
  'Pick one horse from each tier of the field. Every horse scores Win / Place / Show points: 5 for first, 3 for second, 1 for third.',
  1,
  TRUE,
  TRUE,
  '{ "selectionType": "TIERED", "picksPerTier": 1, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [5, 3, 1], "didNotFinishPoints": 0 } } }'::jsonb,
  1,
  NOW()
),
(
  '88888888-8888-4888-8888-888888888888',
  'HORSE_RACING',
  NULL,
  'ROSTER',
  'BUDGET_PICK',
  'horse-racing-budget-win-place-show',
  'Pick 3 horses under the cap, Win / Place / Show',
  'Pick three horses whose prices fit under the salary cap. Every horse scores Win / Place / Show points: 5 for first, 3 for second, 1 for third.',
  2,
  FALSE,
  TRUE,
  '{ "selectionType": "BUDGET_PICK", "rosterSize": 3, "countedScores": 3, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [5, 3, 1], "didNotFinishPoints": 0 } } }'::jsonb,
  1,
  NOW()
),
(
  '99999999-9999-4999-8999-999999999999',
  'HORSE_RACING',
  NULL,
  'ROSTER',
  'RANDOM_DRAW',
  'horse-racing-random-draw-win-place-show',
  'Draw 1 horse each, Win / Place / Show',
  'The classic race sweep: the draw deals every entry one horse at random. It scores Win / Place / Show points: 5 for first, 3 for second, 1 for third.',
  3,
  FALSE,
  TRUE,
  '{ "selectionType": "RANDOM_DRAW", "picksPerEntry": 1, "countedScores": 1, "maxEntriesPerSquad": 1, "scoring": { "participantScoringDefinitionId": "FINISH_POSITION_POINTS", "config": { "pointsTable": [5, 3, 1], "didNotFinishPoints": 0 } } }'::jsonb,
  1,
  NOW()
);
