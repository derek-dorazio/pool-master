-- #2205: an event names the tier and pricing profile its recorded layout and values came from by
-- id, not by the profile's name, which a root admin can change. The layout and values stay in
-- the JSON columns as the copy a later profile edit never moves; the profile is a foreign key,
-- set null when the profile is deleted.

-- AlterTable
ALTER TABLE "sport_events" ADD COLUMN "platform_pricing_profile_id" UUID,
ADD COLUMN "platform_tier_profile_id" UUID;

-- CreateIndex: deleting a profile sets these null without scanning the events.
CREATE INDEX "sport_events_platform_pricing_profile_id_idx" ON "sport_events"("platform_pricing_profile_id");

-- CreateIndex
CREATE INDEX "sport_events_platform_tier_profile_id_idx" ON "sport_events"("platform_tier_profile_id");

-- AddForeignKey
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_platform_pricing_profile_id_fkey" FOREIGN KEY ("platform_pricing_profile_id") REFERENCES "platform_pricing_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_platform_tier_profile_id_fkey" FOREIGN KEY ("platform_tier_profile_id") REFERENCES "platform_tier_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill, once: the profile each event recorded by name, while profile names are still what
-- the events stored. A name no profile has any more leaves the id null.
UPDATE "sport_events" e
SET "platform_pricing_profile_id" = p."id"
FROM "platform_pricing_profiles" p
WHERE e."pricing_config" ->> 'profileName' = p."name";

UPDATE "sport_events" e
SET "platform_tier_profile_id" = p."id"
FROM "platform_tier_profiles" p
WHERE e."tier_config" ->> 'profileName' = p."name";

-- The stored copies no longer carry the name.
UPDATE "sport_events" SET "pricing_config" = "pricing_config" - 'profileName' WHERE "pricing_config" ? 'profileName';
UPDATE "sport_events" SET "tier_config" = "tier_config" - 'profileName' WHERE "tier_config" ? 'profileName';
