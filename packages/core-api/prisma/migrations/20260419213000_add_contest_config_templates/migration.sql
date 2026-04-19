ALTER TABLE "contest_configurations"
  ADD COLUMN "template_id" UUID,
  ADD COLUMN "template_version" INTEGER;

CREATE TABLE "contest_config_templates" (
  "id" UUID NOT NULL,
  "sport" VARCHAR(50) NOT NULL,
  "event_type" VARCHAR(100),
  "contest_type" VARCHAR(50) NOT NULL,
  "config_mode" VARCHAR(50) NOT NULL,
  "template_key" VARCHAR(100) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "config_json" JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "contest_config_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contest_config_templates_sport_event_type_contest_type_config_mode_template_key_key"
  ON "contest_config_templates"("sport", "event_type", "contest_type", "config_mode", "template_key");

CREATE INDEX "contest_config_templates_sport_contest_type_active_sort_order_idx"
  ON "contest_config_templates"("sport", "contest_type", "active", "sort_order");

ALTER TABLE "contest_configurations"
  ADD CONSTRAINT "contest_configurations_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "contest_config_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "contest_config_templates" (
  "id",
  "sport",
  "event_type",
  "contest_type",
  "config_mode",
  "template_key",
  "name",
  "description",
  "sort_order",
  "is_default",
  "active",
  "config_json",
  "schema_version"
) VALUES
(
  '11111111-1111-4111-8111-111111111111',
  'GOLF',
  NULL,
  'SINGLE_EVENT',
  'GOLF_TIERED',
  'golf-tiered-pick-6',
  'Select one from each tier, 4 count',
  'Pick one golfer from each seeded tier. The best four scores count for the entry total.',
  1,
  TRUE,
  TRUE,
  '{
    "mode": "GOLF_TIERED",
    "maxEntriesPerSquad": 1,
    "rosterSize": 6,
    "countedScores": 4,
    "tierSource": "ODDS",
    "tierGeneration": { "defaultTierSize": 10 },
    "tiers": [
      { "tierKey": "A", "label": "Tier A", "pickCount": 1, "startPosition": 1, "endPosition": 10 },
      { "tierKey": "B", "label": "Tier B", "pickCount": 1, "startPosition": 11, "endPosition": 20 },
      { "tierKey": "C", "label": "Tier C", "pickCount": 1, "startPosition": 21, "endPosition": 30 },
      { "tierKey": "D", "label": "Tier D", "pickCount": 1, "startPosition": 31, "endPosition": 40 },
      { "tierKey": "E", "label": "Tier E", "pickCount": 1, "startPosition": 41, "endPosition": 50 },
      { "tierKey": "F", "label": "Tier F", "pickCount": 1, "startPosition": 51, "endPosition": null }
    ],
    "cutRule": { "type": "FIXED_SCORE", "fixedScore": 80 },
    "playoffHandling": "EXCLUDE_PLAYOFF_HOLES",
    "displayScoring": "TO_PAR",
    "tiebreaker": { "type": "PREDICT_WINNING_SCORE" }
  }'::jsonb,
  1
),
(
  '22222222-2222-4222-8222-222222222222',
  'GOLF',
  NULL,
  'SINGLE_EVENT',
  'GOLF_TIERED',
  'golf-tiered-pick-12',
  'Select two from each tier, 8 count',
  'Pick two golfers from each seeded tier. The best eight scores count for the entry total.',
  2,
  FALSE,
  TRUE,
  '{
    "mode": "GOLF_TIERED",
    "maxEntriesPerSquad": 1,
    "rosterSize": 12,
    "countedScores": 8,
    "tierSource": "ODDS",
    "tierGeneration": { "defaultTierSize": 10 },
    "tiers": [
      { "tierKey": "A", "label": "Tier A", "pickCount": 2, "startPosition": 1, "endPosition": 10 },
      { "tierKey": "B", "label": "Tier B", "pickCount": 2, "startPosition": 11, "endPosition": 20 },
      { "tierKey": "C", "label": "Tier C", "pickCount": 2, "startPosition": 21, "endPosition": 30 },
      { "tierKey": "D", "label": "Tier D", "pickCount": 2, "startPosition": 31, "endPosition": 40 },
      { "tierKey": "E", "label": "Tier E", "pickCount": 2, "startPosition": 41, "endPosition": 50 },
      { "tierKey": "F", "label": "Tier F", "pickCount": 2, "startPosition": 51, "endPosition": null }
    ],
    "cutRule": { "type": "FIXED_SCORE", "fixedScore": 80 },
    "playoffHandling": "EXCLUDE_PLAYOFF_HOLES",
    "displayScoring": "TO_PAR",
    "tiebreaker": { "type": "PREDICT_WINNING_SCORE" }
  }'::jsonb,
  1
),
(
  '33333333-3333-4333-8333-333333333333',
  'GOLF',
  NULL,
  'SINGLE_EVENT',
  'GOLF_CATEGORY_PICKS',
  'golf-category-picks',
  'Category picks',
  'Pick one golfer from each enabled category using the default category set.',
  3,
  FALSE,
  TRUE,
  '{
    "mode": "GOLF_CATEGORY_PICKS",
    "maxEntriesPerSquad": 1,
    "categories": [
      { "categoryKey": "SENIOR", "label": "Senior", "pickCount": 1 },
      { "categoryKey": "ROOKIE", "label": "Rookie", "pickCount": 1 },
      { "categoryKey": "PREVIOUS_WINNER", "label": "Previous Winner", "pickCount": 1 },
      { "categoryKey": "US_PLAYER", "label": "US Player", "pickCount": 1 },
      { "categoryKey": "INTERNATIONAL_PLAYER", "label": "International Player", "pickCount": 1 }
    ],
    "cutRule": { "type": "FIXED_SCORE", "fixedScore": 80 },
    "playoffHandling": "EXCLUDE_PLAYOFF_HOLES",
    "displayScoring": "TO_PAR",
    "tiebreaker": { "type": "PREDICT_WINNING_SCORE" }
  }'::jsonb,
  1
);
