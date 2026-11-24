-- League model 4 (#2001): who competes and how a league is scored live on the sport league
-- only, and each league gets its playing positions.
--
-- 1. Every sport league states its participant type and scoring family. Each takes its sport's
--    values, which until now were the sport row's column and the code registry's copy; both
--    copies go.
-- 2. SportLeaguePosition and its provider codes, seeded for the NFL. QB, RB, WR and TE are
--    field-eligible; FB, K and P are listed so the roster sync drops them on purpose.

-- 1. Participant type and scoring family, required on the sport league.
UPDATE "sport_leagues" sl
SET "participant_type" = s."participant_type"
FROM "sports" s
WHERE s."id" = sl."sport_id" AND sl."participant_type" IS NULL;

UPDATE "sport_leagues" sl
SET "scoring_family" = (CASE s."sport"
    WHEN 'GOLF' THEN 'STROKE_PLAY'
    WHEN 'HORSE_RACING' THEN 'FINISH_POSITION'
    WHEN 'AUTO_RACING' THEN 'FINISH_POSITION'
    WHEN 'CYCLING' THEN 'FINISH_POSITION'
    WHEN 'RUNNING' THEN 'FINISH_POSITION'
    ELSE 'HEAD_TO_HEAD'
  END)::"PrismaScoringFamily"
FROM "sports" s
WHERE s."id" = sl."sport_id" AND sl."scoring_family" IS NULL;

ALTER TABLE "sport_leagues" ALTER COLUMN "participant_type" SET NOT NULL,
ALTER COLUMN "scoring_family" SET NOT NULL;

ALTER TABLE "sports" DROP COLUMN "participant_type";

-- 2. Positions.
CREATE TABLE "sport_league_positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_field_eligible" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_positions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sport_league_positions_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE TABLE "sport_league_position_provider_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_league_position_id" UUID NOT NULL,
    "sport_league_provider_mapping_id" UUID NOT NULL,
    "provider_code" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_position_provider_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sport_league_positions_sport_league_id_code_key" ON "sport_league_positions"("sport_league_id", "code");

CREATE UNIQUE INDEX "sport_league_positions_sport_league_id_id_key" ON "sport_league_positions"("sport_league_id", "id");

CREATE INDEX "sport_league_position_provider_mappings_sport_league_id_spo_idx" ON "sport_league_position_provider_mappings"("sport_league_id", "sport_league_position_id");

CREATE INDEX "sport_league_position_provider_mappings_provider_mapping_idx" ON "sport_league_position_provider_mappings"("sport_league_id", "sport_league_provider_mapping_id");

CREATE UNIQUE INDEX "sport_league_position_provider_mappings_sport_league_provid_key" ON "sport_league_position_provider_mappings"("sport_league_provider_mapping_id", "provider_code");

ALTER TABLE "sport_league_positions" ADD CONSTRAINT "sport_league_positions_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sport_league_position_provider_mappings" ADD CONSTRAINT "sport_league_position_provider_mappings_position_fkey" FOREIGN KEY ("sport_league_id", "sport_league_position_id") REFERENCES "sport_league_positions"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sport_league_position_provider_mappings" ADD CONSTRAINT "sport_league_position_provider_mappings_provider_mapping_fkey" FOREIGN KEY ("sport_league_id", "sport_league_provider_mapping_id") REFERENCES "sport_league_provider_mappings"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The NFL's positions (sport league f91f2566-…), and BALLDONTLIE's `position_abbreviation`
-- code for each, on the NFL's BALLDONTLIE mapping (provider 6f1e9a52-…, league `nfl`).
INSERT INTO "sport_league_positions" ("sport_league_id", "code", "display_order", "is_field_eligible", "updated_at")
SELECT 'f91f2566-1978-4171-a706-ae417c4d601a', p.code, p.display_order, p.is_field_eligible, now()
FROM (VALUES
  ('QB', 1, true), ('RB', 2, true), ('WR', 3, true), ('TE', 4, true),
  ('FB', 5, false), ('K', 6, false), ('P', 7, false)
) AS p(code, display_order, is_field_eligible)
WHERE EXISTS (SELECT 1 FROM "sport_leagues" WHERE "id" = 'f91f2566-1978-4171-a706-ae417c4d601a');

INSERT INTO "sport_league_position_provider_mappings" ("sport_league_id", "sport_league_position_id", "sport_league_provider_mapping_id", "provider_code", "updated_at")
SELECT pos."sport_league_id", pos."id", m."id", c.provider_code, now()
FROM (VALUES
  ('QB', 'QB'), ('RB', 'RB'), ('WR', 'WR'), ('TE', 'TE'), ('FB', 'FB'), ('K', 'K'), ('P', 'P')
) AS c(code, provider_code)
JOIN "sport_league_positions" pos ON pos."code" = c.code
  AND pos."sport_league_id" = 'f91f2566-1978-4171-a706-ae417c4d601a'
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = pos."sport_league_id"
JOIN "provider_leagues" pl ON pl."id" = m."provider_league_id"
  AND pl."provider_id" = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11'
  AND pl."code" = 'nfl';
