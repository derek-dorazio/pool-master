-- League model 21b part A (#2052): conferences and divisions move from team metadata into the
-- model. A league's conferences and their divisions are definitions, set here by migration with
-- the codes the provider's feed sends for them (inclusion only, as positions are); the events sync
-- writes each team's conference and division per Season from the team payload it already reads.
-- A competition names its conference only in a POSTSEASON_CONFERENCE phase: the phase's value is
-- carried onto the competition through its composite key to the phase, so a check can test it.
-- Two finding kinds name a code the league has no row for.
--
-- The college conferences (NCAA basketball's and football's) follow in their own migration, from
-- the vendor's conference lists. Until then those leagues name no conference codes, so their teams
-- get no rows and raise nothing.

-- AlterEnum
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'CONFERENCE_UNMAPPED';
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'DIVISION_UNMAPPED';

-- DropForeignKey
ALTER TABLE "sport_league_competitions" DROP CONSTRAINT "sport_league_competitions_sport_league_id_sport_league_pha_fkey";

-- AlterTable: each competition takes its phase's value before the column is required.
ALTER TABLE "sport_league_competitions" ADD COLUMN     "conference_id" UUID,
ADD COLUMN     "league_phase" "PrismaLeaguePhase";

UPDATE "sport_league_competitions" c SET "league_phase" = p."phase"
FROM "sport_league_phases" p WHERE p."id" = c."sport_league_phase_id";

ALTER TABLE "sport_league_competitions" ALTER COLUMN "league_phase" SET NOT NULL;

-- CreateTable
CREATE TABLE "sport_league_season_team_conferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "sport_league_season_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "conference_id" UUID NOT NULL,
    "division_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_season_team_conferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_league_conferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_conferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_league_conference_divisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "conference_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_conference_divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_league_conference_provider_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "conference_id" UUID NOT NULL,
    "sport_league_provider_mapping_id" UUID NOT NULL,
    "provider_code" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_conference_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_league_division_provider_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sport_league_id" UUID NOT NULL,
    "conference_id" UUID NOT NULL,
    "division_id" UUID NOT NULL,
    "sport_league_provider_mapping_id" UUID NOT NULL,
    "provider_code" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sport_league_division_provider_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sport_league_season_team_conferences_team_idx" ON "sport_league_season_team_conferences"("sport_league_id", "participant_id");

-- CreateIndex
CREATE INDEX "sport_league_season_team_conferences_conference_idx" ON "sport_league_season_team_conferences"("sport_league_id", "conference_id");

-- CreateIndex
CREATE INDEX "sport_league_season_team_conferences_division_idx" ON "sport_league_season_team_conferences"("sport_league_id", "conference_id", "division_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_season_team_conferences_season_team_key" ON "sport_league_season_team_conferences"("sport_league_season_id", "participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_conferences_sport_league_id_code_key" ON "sport_league_conferences"("sport_league_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_conferences_sport_league_id_id_key" ON "sport_league_conferences"("sport_league_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_conference_divisions_conference_id_code_key" ON "sport_league_conference_divisions"("conference_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_conference_divisions_sport_league_id_conferenc_key" ON "sport_league_conference_divisions"("sport_league_id", "conference_id", "id");

-- CreateIndex
CREATE INDEX "sport_league_conference_provider_mappings_sport_league_id_c_idx" ON "sport_league_conference_provider_mappings"("sport_league_id", "conference_id");

-- CreateIndex
CREATE INDEX "sport_league_conference_provider_mappings_provider_mapping_idx" ON "sport_league_conference_provider_mappings"("sport_league_id", "sport_league_provider_mapping_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_conference_provider_mappings_sport_league_prov_key" ON "sport_league_conference_provider_mappings"("sport_league_provider_mapping_id", "provider_code");

-- CreateIndex
CREATE INDEX "sport_league_division_provider_mappings_division_idx" ON "sport_league_division_provider_mappings"("sport_league_id", "conference_id", "division_id");

-- CreateIndex
CREATE INDEX "sport_league_division_provider_mappings_provider_mapping_idx" ON "sport_league_division_provider_mappings"("sport_league_id", "sport_league_provider_mapping_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_division_provider_mappings_code_key" ON "sport_league_division_provider_mappings"("sport_league_provider_mapping_id", "conference_id", "provider_code");

-- CreateIndex
CREATE INDEX "sport_league_competitions_sport_league_id_conference_id_idx" ON "sport_league_competitions"("sport_league_id", "conference_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_league_phases_sport_league_id_id_phase_key" ON "sport_league_phases"("sport_league_id", "id", "phase");

-- AddForeignKey
ALTER TABLE "sport_league_season_team_conferences" ADD CONSTRAINT "sport_league_season_team_conferences_season_fkey" FOREIGN KEY ("sport_league_id", "sport_league_season_id") REFERENCES "sport_league_seasons"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_team_conferences" ADD CONSTRAINT "sport_league_season_team_conferences_team_fkey" FOREIGN KEY ("sport_league_id", "participant_id") REFERENCES "participants"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_team_conferences" ADD CONSTRAINT "sport_league_season_team_conferences_conference_fkey" FOREIGN KEY ("sport_league_id", "conference_id") REFERENCES "sport_league_conferences"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_season_team_conferences" ADD CONSTRAINT "sport_league_season_team_conferences_division_fkey" FOREIGN KEY ("sport_league_id", "conference_id", "division_id") REFERENCES "sport_league_conference_divisions"("sport_league_id", "conference_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_conferences" ADD CONSTRAINT "sport_league_conferences_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_conference_divisions" ADD CONSTRAINT "sport_league_conference_divisions_conference_fkey" FOREIGN KEY ("sport_league_id", "conference_id") REFERENCES "sport_league_conferences"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_conference_provider_mappings" ADD CONSTRAINT "sport_league_conference_provider_mappings_conference_fkey" FOREIGN KEY ("sport_league_id", "conference_id") REFERENCES "sport_league_conferences"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_conference_provider_mappings" ADD CONSTRAINT "sport_league_conference_provider_mappings_provider_mapping_fkey" FOREIGN KEY ("sport_league_id", "sport_league_provider_mapping_id") REFERENCES "sport_league_provider_mappings"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_division_provider_mappings" ADD CONSTRAINT "sport_league_division_provider_mappings_division_fkey" FOREIGN KEY ("sport_league_id", "conference_id", "division_id") REFERENCES "sport_league_conference_divisions"("sport_league_id", "conference_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_division_provider_mappings" ADD CONSTRAINT "sport_league_division_provider_mappings_provider_mapping_fkey" FOREIGN KEY ("sport_league_id", "sport_league_provider_mapping_id") REFERENCES "sport_league_provider_mappings"("sport_league_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_competitions" ADD CONSTRAINT "sport_league_competitions_phase_fkey" FOREIGN KEY ("sport_league_id", "sport_league_phase_id", "league_phase") REFERENCES "sport_league_phases"("sport_league_id", "id", "phase") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_league_competitions" ADD CONSTRAINT "sport_league_competitions_conference_fkey" FOREIGN KEY ("sport_league_id", "conference_id") REFERENCES "sport_league_conferences"("sport_league_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks: codes are codes, and only a POSTSEASON_CONFERENCE competition names a conference.
ALTER TABLE "sport_league_conferences" ADD CONSTRAINT "sport_league_conferences_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9_]*$');
ALTER TABLE "sport_league_conference_divisions" ADD CONSTRAINT "sport_league_conference_divisions_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9_]*$');
ALTER TABLE "sport_league_competitions" ADD CONSTRAINT "sport_league_competitions_conference_phase" CHECK ("conference_id" IS NULL OR "league_phase" = 'POSTSEASON_CONFERENCE');

-- Seed: the professional leagues' conferences and divisions, each with BALLDONTLIE's code for it
-- on the league's BALLDONTLIE mapping. A league missing from this database is skipped.
CREATE TEMPORARY TABLE "seed_conferences" ("sport_league_id" UUID, "provider_league_code" TEXT, "code" TEXT, "name" TEXT, "description" TEXT, "display_order" INT, "provider_code" TEXT) ON COMMIT DROP;
INSERT INTO "seed_conferences" VALUES
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'AFC', 'American Football Conference', 'One of the NFL''s two conferences; its champion meets the NFC''s in the Super Bowl.', 1, 'AFC'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'NFC', 'National Football Conference', 'One of the NFL''s two conferences; its champion meets the AFC''s in the Super Bowl.', 2, 'NFC'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', 'nba', 'EAST', 'Eastern Conference', 'The NBA''s Eastern Conference, which seeds its own half of the playoffs.', 1, 'East'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', 'nba', 'WEST', 'Western Conference', 'The NBA''s Western Conference, which seeds its own half of the playoffs.', 2, 'West'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', 'nhl', 'EAST', 'Eastern Conference', 'The NHL''s Eastern Conference: the Atlantic and Metropolitan divisions, one half of the playoffs.', 1, 'Eastern'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', 'nhl', 'WEST', 'Western Conference', 'The NHL''s Western Conference: the Central and Pacific divisions, one half of the playoffs.', 2, 'Western'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', 'mlb', 'AL', 'American League', 'MLB''s American League, which seeds six clubs for its side of the postseason.', 1, 'American'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', 'mlb', 'NL', 'National League', 'MLB''s National League, which seeds six clubs for its side of the postseason.', 2, 'National'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61', 'wnba', 'EAST', 'Eastern Conference', 'The WNBA''s Eastern Conference; the playoffs seed across the league, not by conference.', 1, 'Eastern'),
  ('15d608a9-d556-4a65-9cd9-1093f1a40b61', 'wnba', 'WEST', 'Western Conference', 'The WNBA''s Western Conference; the playoffs seed across the league, not by conference.', 2, 'Western');

CREATE TEMPORARY TABLE "seed_divisions" ("sport_league_id" UUID, "provider_league_code" TEXT, "conference_code" TEXT, "code" TEXT, "name" TEXT, "description" TEXT, "display_order" INT, "provider_code" TEXT) ON COMMIT DROP;
INSERT INTO "seed_divisions" VALUES
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'AFC', 'EAST', 'AFC East', 'A division of the NFL''s AFC; division winners are seeded in the playoffs.', 1, 'EAST'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'AFC', 'NORTH', 'AFC North', 'A division of the NFL''s AFC; division winners are seeded in the playoffs.', 2, 'NORTH'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'AFC', 'SOUTH', 'AFC South', 'A division of the NFL''s AFC; division winners are seeded in the playoffs.', 3, 'SOUTH'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'AFC', 'WEST', 'AFC West', 'A division of the NFL''s AFC; division winners are seeded in the playoffs.', 4, 'WEST'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'NFC', 'EAST', 'NFC East', 'A division of the NFL''s NFC; division winners are seeded in the playoffs.', 1, 'EAST'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'NFC', 'NORTH', 'NFC North', 'A division of the NFL''s NFC; division winners are seeded in the playoffs.', 2, 'NORTH'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'NFC', 'SOUTH', 'NFC South', 'A division of the NFL''s NFC; division winners are seeded in the playoffs.', 3, 'SOUTH'),
  ('f91f2566-1978-4171-a706-ae417c4d601a', 'nfl', 'NFC', 'WEST', 'NFC West', 'A division of the NFL''s NFC; division winners are seeded in the playoffs.', 4, 'WEST'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', 'nba', 'EAST', 'ATLANTIC', 'Atlantic Division', 'A division of the NBA''s Eastern Conference; it decides no playoff place of its own.', 1, 'Atlantic'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', 'nba', 'EAST', 'CENTRAL', 'Central Division', 'A division of the NBA''s Eastern Conference; it decides no playoff place of its own.', 2, 'Central'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', 'nba', 'EAST', 'SOUTHEAST', 'Southeast Division', 'A division of the NBA''s Eastern Conference; it decides no playoff place of its own.', 3, 'Southeast'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', 'nba', 'WEST', 'NORTHWEST', 'Northwest Division', 'A division of the NBA''s Western Conference; it decides no playoff place of its own.', 1, 'Northwest'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', 'nba', 'WEST', 'PACIFIC', 'Pacific Division', 'A division of the NBA''s Western Conference; it decides no playoff place of its own.', 2, 'Pacific'),
  ('09f45f12-11be-43ac-bfa6-70a53f6e0169', 'nba', 'WEST', 'SOUTHWEST', 'Southwest Division', 'A division of the NBA''s Western Conference; it decides no playoff place of its own.', 3, 'Southwest'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', 'nhl', 'EAST', 'ATLANTIC', 'Atlantic Division', 'A division of the NHL''s Eastern Conference; division winners are seeded in the playoffs.', 1, 'Atlantic'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', 'nhl', 'EAST', 'METROPOLITAN', 'Metropolitan Division', 'A division of the NHL''s Eastern Conference; division winners are seeded in the playoffs.', 2, 'Metropolitan'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', 'nhl', 'WEST', 'CENTRAL', 'Central Division', 'A division of the NHL''s Western Conference; division winners are seeded in the playoffs.', 1, 'Central'),
  ('c024b44e-bb26-42f7-954f-ecdd01a1991d', 'nhl', 'WEST', 'PACIFIC', 'Pacific Division', 'A division of the NHL''s Western Conference; division winners are seeded in the playoffs.', 2, 'Pacific'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', 'mlb', 'AL', 'EAST', 'American League East', 'A division of the MLB''s American League; division winners are seeded in the playoffs.', 1, 'East'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', 'mlb', 'AL', 'CENTRAL', 'American League Central', 'A division of the MLB''s American League; division winners are seeded in the playoffs.', 2, 'Central'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', 'mlb', 'AL', 'WEST', 'American League West', 'A division of the MLB''s American League; division winners are seeded in the playoffs.', 3, 'West'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', 'mlb', 'NL', 'EAST', 'National League East', 'A division of the MLB''s National League; division winners are seeded in the playoffs.', 1, 'East'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', 'mlb', 'NL', 'CENTRAL', 'National League Central', 'A division of the MLB''s National League; division winners are seeded in the playoffs.', 2, 'Central'),
  ('e4d6bcae-cfca-40f3-b9a9-317fed090296', 'mlb', 'NL', 'WEST', 'National League West', 'A division of the MLB''s National League; division winners are seeded in the playoffs.', 3, 'West');

INSERT INTO "sport_league_conferences" ("sport_league_id", "code", "name", "description", "display_order", "updated_at")
SELECT s."sport_league_id", s."code", s."name", s."description", s."display_order", now()
FROM "seed_conferences" s
WHERE EXISTS (SELECT 1 FROM "sport_leagues" l WHERE l."id" = s."sport_league_id");

INSERT INTO "sport_league_conference_divisions" ("sport_league_id", "conference_id", "code", "name", "description", "display_order", "updated_at")
SELECT c."sport_league_id", c."id", s."code", s."name", s."description", s."display_order", now()
FROM "seed_divisions" s
JOIN "sport_league_conferences" c ON c."sport_league_id" = s."sport_league_id" AND c."code" = s."conference_code";

INSERT INTO "sport_league_conference_provider_mappings" ("sport_league_id", "conference_id", "sport_league_provider_mapping_id", "provider_code", "updated_at")
SELECT c."sport_league_id", c."id", m."id", s."provider_code", now()
FROM "seed_conferences" s
JOIN "sport_league_conferences" c ON c."sport_league_id" = s."sport_league_id" AND c."code" = s."code"
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = c."sport_league_id"
JOIN "provider_leagues" pl ON pl."id" = m."provider_league_id"
  AND pl."provider_id" = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11'
  AND pl."code" = s."provider_league_code";

INSERT INTO "sport_league_division_provider_mappings" ("sport_league_id", "conference_id", "division_id", "sport_league_provider_mapping_id", "provider_code", "updated_at")
SELECT d."sport_league_id", d."conference_id", d."id", m."id", s."provider_code", now()
FROM "seed_divisions" s
JOIN "sport_league_conferences" c ON c."sport_league_id" = s."sport_league_id" AND c."code" = s."conference_code"
JOIN "sport_league_conference_divisions" d ON d."conference_id" = c."id" AND d."code" = s."code"
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = c."sport_league_id"
JOIN "provider_leagues" pl ON pl."id" = m."provider_league_id"
  AND pl."provider_id" = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11'
  AND pl."code" = s."provider_league_code";
