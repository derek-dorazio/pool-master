-- #1853: a participant belongs to one sport league, as the provider's ids do. The league
-- affiliation table goes; its rank moves onto the participant. A provider mapping is unique per
-- (provider, external id, sport league), since a Clutch Card league's players carry the same feed
-- ids as the next round's. No data is preserved beyond what applies cleanly: every site's data is
-- test data and QA is rebuilt after this (Derek, 2026-11-18). A participant takes one of its
-- leagues (its best-ranked affiliation), or its sport's first league by name when it has none; a
-- sport with participants and no league gets an inactive "Participants" league to hold them, naming
-- the first tier and pricing profiles by name (#1844), since it is never offered.

ALTER TABLE "participants" ADD COLUMN "sport_league_id" UUID, ADD COLUMN "ranking" INTEGER;

UPDATE "participants" AS p
SET "sport_league_id" = a."sport_league_id", "ranking" = a."ranking"
FROM (
  SELECT DISTINCT ON ("participant_id") "participant_id", "sport_league_id", "ranking"
  FROM "participant_league_affiliations"
  ORDER BY "participant_id", "ranking" ASC NULLS LAST, "sport_league_id"
) AS a
WHERE a."participant_id" = p."id";

INSERT INTO "sport_leagues" ("sport_id", "name", "is_active", "tier_profile_id", "pricing_profile_id", "updated_at")
SELECT DISTINCT p."sport_id", 'Participants', false,
  (SELECT "id" FROM "tier_profiles" ORDER BY "name", "id" LIMIT 1),
  (SELECT "id" FROM "pricing_profiles" ORDER BY "name", "id" LIMIT 1),
  now()
FROM "participants" AS p
WHERE p."sport_league_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "sport_leagues" AS l WHERE l."sport_id" = p."sport_id");

UPDATE "participants" AS p
SET "sport_league_id" = (
  SELECT l."id" FROM "sport_leagues" AS l WHERE l."sport_id" = p."sport_id" ORDER BY l."name", l."id" LIMIT 1
)
WHERE p."sport_league_id" IS NULL;

ALTER TABLE "participant_provider_mappings" ADD COLUMN "sport_league_id" UUID;

UPDATE "participant_provider_mappings" AS m
SET "sport_league_id" = p."sport_league_id"
FROM "participants" AS p
WHERE p."id" = m."participant_id";

-- DropForeignKey
ALTER TABLE "participant_league_affiliations" DROP CONSTRAINT "participant_league_affiliations_participant_id_fkey";
ALTER TABLE "participant_league_affiliations" DROP CONSTRAINT "participant_league_affiliations_sport_league_id_fkey";
ALTER TABLE "participants" DROP CONSTRAINT "participants_sport_id_fkey";

-- DropIndex
DROP INDEX "participant_provider_mappings_provider_id_external_id_key";
DROP INDEX "participants_sport_id_name_idx";
DROP INDEX "participants_sport_id_status_idx";

-- AlterTable
ALTER TABLE "participant_provider_mappings" ALTER COLUMN "sport_league_id" SET NOT NULL;
ALTER TABLE "participants" DROP COLUMN "sport_id", ALTER COLUMN "sport_league_id" SET NOT NULL;

-- DropTable
DROP TABLE "participant_league_affiliations";

-- CreateIndex
CREATE INDEX "participant_provider_mappings_sport_league_id_provider_id_idx" ON "participant_provider_mappings"("sport_league_id", "provider_id");
CREATE UNIQUE INDEX "participant_provider_mappings_provider_id_external_id_sport_key" ON "participant_provider_mappings"("provider_id", "external_id", "sport_league_id");
CREATE INDEX "participants_sport_league_id_status_idx" ON "participants"("sport_league_id", "status");
CREATE INDEX "participants_sport_league_id_name_idx" ON "participants"("sport_league_id", "name");
CREATE INDEX "participants_sport_league_id_ranking_idx" ON "participants"("sport_league_id", "ranking");

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "participant_provider_mappings" ADD CONSTRAINT "participant_provider_mappings_sport_league_id_fkey" FOREIGN KEY ("sport_league_id") REFERENCES "sport_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The FIELD_LINKED ready check goes: every field participant is the event league's, made by the
-- sync with its feed id, so there is nothing left to link. A stored hold forgets it, and a hold
-- whose only reason it was is cleared, as if never checked: the next check decides the event.
UPDATE "sport_events"
SET "auto_release_checked_at" = NULL, "auto_release_outcome" = NULL, "auto_release_failed_checks" = ARRAY[]::"PrismaReleaseCheckKey"[]
WHERE "auto_release_outcome" = 'HELD' AND "auto_release_failed_checks" = ARRAY['FIELD_LINKED']::"PrismaReleaseCheckKey"[];
UPDATE "sport_events" SET "auto_release_failed_checks" = array_remove("auto_release_failed_checks", 'FIELD_LINKED')
WHERE 'FIELD_LINKED' = ANY("auto_release_failed_checks");
ALTER TYPE "PrismaReleaseCheckKey" RENAME TO "PrismaReleaseCheckKey_old";
CREATE TYPE "PrismaReleaseCheckKey" AS ENUM ('NOT_STARTED', 'ROUNDS_SCHEDULED', 'FIELD_LOADED', 'TIERS_ASSIGNED', 'TIERS_FILLED', 'PRICES_ASSIGNED', 'BRACKET_COMPLETE', 'CONTEST_SETUPS_ON');
ALTER TABLE "sport_events" ALTER COLUMN "auto_release_failed_checks" DROP DEFAULT;
ALTER TABLE "sport_events" ALTER COLUMN "auto_release_failed_checks" TYPE "PrismaReleaseCheckKey"[] USING ("auto_release_failed_checks"::text[]::"PrismaReleaseCheckKey"[]);
ALTER TABLE "sport_events" ALTER COLUMN "auto_release_failed_checks" SET DEFAULT ARRAY[]::"PrismaReleaseCheckKey"[];
DROP TYPE "PrismaReleaseCheckKey_old";
