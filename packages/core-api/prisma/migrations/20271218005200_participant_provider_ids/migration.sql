-- League model 1e (#2040): a participant's feed ids live only in ParticipantProviderMapping, as
-- the provider's raw id, keyed to a Provider row; sync runs and sync jobs carry a Provider foreign
-- key; a run's event is a SportEvent foreign key. The unused mapping confidence and the
-- name-ordered tier and price source go.
--
-- The only provider with rows is BALLDONTLIE, whose rows carry the source id 'balldontlie'. Rows of
-- any other source id (the QA mock feed's were deleted by 20271218004000) have no Provider and go.

-- A test data file's feed ids, kept on the participant as JSON, become mappings first, so no
-- provider id is lost when the columns go. Only ids of a provider with a row are kept.
INSERT INTO "participant_provider_mappings" ("participant_id", "sport_league_id", "provider_id", "external_id", "confidence", "mapped_at", "updated_at")
SELECT p."id", p."sport_league_id", ids.key, ids.value, 'EXACT', now(), now()
FROM "participants" p
CROSS JOIN LATERAL jsonb_each_text(p."external_ids"::jsonb) AS ids
WHERE ids.key = 'balldontlie'
ON CONFLICT ("provider_id", "external_id", "sport_league_id") DO NOTHING;

-- ParticipantProviderMapping: the Provider foreign key, the participant's kind, the raw feed id.
DROP INDEX "participant_provider_mappings_provider_id_external_id_sport_key";
DROP INDEX "participant_provider_mappings_sport_league_id_provider_id_idx";
ALTER TABLE "participant_provider_mappings" RENAME COLUMN "provider_id" TO "provider_source_id";
ALTER TABLE "participant_provider_mappings"
  ADD COLUMN "provider_id" UUID,
  ADD COLUMN "participant_type" "PrismaParticipantType";
UPDATE "participant_provider_mappings" m
SET "provider_id" = pr."id"
FROM "providers" pr
WHERE pr."code" = 'BALLDONTLIE' AND m."provider_source_id" = 'balldontlie';
DELETE FROM "participant_provider_mappings" WHERE "provider_id" IS NULL;
UPDATE "participant_provider_mappings" m
SET "participant_type" = p."participant_type"
FROM "participants" p
WHERE p."id" = m."participant_id";
-- Team ids were prefixed by league (`nfl-team-12`); the league is on the row now, so the id is
-- the provider's own (`12`). A player's id was never prefixed.
-- A prefixed id whose raw id the same participant kind in the same league already holds (for
-- the same provider) would break the unique index below: the raw mapping is the sync's, so the
-- prefixed duplicate goes first.
DELETE FROM "participant_provider_mappings" m
USING "participant_provider_mappings" raw
WHERE m."external_id" ~ '^[a-z]+(-[a-z]+)*-team-[0-9]+$'
  AND raw."id" <> m."id"
  AND raw."provider_id" = m."provider_id"
  AND raw."sport_league_id" = m."sport_league_id"
  AND raw."participant_type" = m."participant_type"
  AND raw."external_id" = regexp_replace(m."external_id", '^[a-z]+(-[a-z]+)*-team-([0-9]+)$', '\2');
-- Two prefixed ids that strip to one raw id in a league (two prefixes): keep the oldest.
DELETE FROM "participant_provider_mappings" m
USING "participant_provider_mappings" other
WHERE m."external_id" ~ '^[a-z]+(-[a-z]+)*-team-[0-9]+$'
  AND other."external_id" ~ '^[a-z]+(-[a-z]+)*-team-[0-9]+$'
  AND other."provider_id" = m."provider_id"
  AND other."sport_league_id" = m."sport_league_id"
  AND other."participant_type" = m."participant_type"
  AND regexp_replace(other."external_id", '^[a-z]+(-[a-z]+)*-team-([0-9]+)$', '\2') = regexp_replace(m."external_id", '^[a-z]+(-[a-z]+)*-team-([0-9]+)$', '\2')
  AND (other."mapped_at", other."id") < (m."mapped_at", m."id");
UPDATE "participant_provider_mappings"
SET "external_id" = regexp_replace("external_id", '^[a-z]+(-[a-z]+)*-team-([0-9]+)$', '\2')
WHERE "external_id" ~ '^[a-z]+(-[a-z]+)*-team-[0-9]+$';
ALTER TABLE "participant_provider_mappings"
  ALTER COLUMN "provider_id" SET NOT NULL,
  ALTER COLUMN "participant_type" SET NOT NULL,
  DROP COLUMN "provider_source_id",
  DROP COLUMN "confidence";
CREATE UNIQUE INDEX "participant_provider_mappings_provider_id_external_id_sport_key" ON "participant_provider_mappings"("provider_id", "external_id", "sport_league_id", "participant_type");
CREATE INDEX "participant_provider_mappings_sport_league_id_provider_id_idx" ON "participant_provider_mappings"("sport_league_id", "provider_id");
CREATE INDEX "participant_provider_mappings_sport_league_id_external_id_idx" ON "participant_provider_mappings"("sport_league_id", "external_id");
ALTER TABLE "participant_provider_mappings" ADD CONSTRAINT "participant_provider_mappings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TYPE "PrismaParticipantMappingConfidence";

-- Participant: no provider id of its own.
ALTER TABLE "participants" DROP COLUMN "external_id", DROP COLUMN "external_ids";

-- ProviderSyncRun: the Provider foreign key; the provider's event id goes, its event is
-- `sport_event_id`, now a foreign key (a run of a deleted event keeps its history, unscoped).
DROP INDEX "provider_sync_runs_provider_id_created_at_idx";
ALTER TABLE "provider_sync_runs" RENAME COLUMN "provider_id" TO "provider_source_id";
ALTER TABLE "provider_sync_runs" ADD COLUMN "provider_id" UUID;
UPDATE "provider_sync_runs" r
SET "provider_id" = pr."id"
FROM "providers" pr
WHERE pr."code" = 'BALLDONTLIE' AND r."provider_source_id" = 'balldontlie';
DELETE FROM "provider_sync_runs" WHERE "provider_id" IS NULL;
UPDATE "provider_sync_runs" r
SET "sport_event_id" = NULL
WHERE r."sport_event_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "sport_events" e WHERE e."id" = r."sport_event_id");
ALTER TABLE "provider_sync_runs"
  ALTER COLUMN "provider_id" SET NOT NULL,
  DROP COLUMN "provider_source_id",
  DROP COLUMN "event_id";
CREATE INDEX "provider_sync_runs_provider_id_created_at_idx" ON "provider_sync_runs"("provider_id", "created_at" DESC);
ALTER TABLE "provider_sync_runs" ADD CONSTRAINT "provider_sync_runs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_sync_runs" ADD CONSTRAINT "provider_sync_runs_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BackgroundJob: the provider a sync job reads, set for the jobs already queued from their payload.
ALTER TABLE "background_jobs" ADD COLUMN "provider_id" UUID;
UPDATE "background_jobs" j
SET "provider_id" = pr."id"
FROM "providers" pr
WHERE pr."code" = 'BALLDONTLIE' AND j."payload"->>'providerId' = 'balldontlie';
UPDATE "background_jobs" j
SET "provider_id" = pr."id"
FROM "providers" pr, "sport_leagues" l, "sport_league_provider_mappings" slpm, "provider_leagues" pl
WHERE j."type" = 'SYNC_LEAGUE_EVENTS' AND j."provider_id" IS NULL
  AND l."id"::text = j."payload"->>'sportLeagueId'
  AND slpm."id" = l."selected_provider_mapping_id" AND pl."id" = slpm."provider_league_id" AND pr."id" = pl."provider_id";
CREATE INDEX "background_jobs_provider_id_idx" ON "background_jobs"("provider_id");
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ValuationSource: AUTO_NAME goes (a field is never tiered or priced by name, rules/
-- domain-model-conventions-rules.md §17). On a draft event a tier or price made that way is
-- cleared, not frozen as a manual one: the next field sync tiers and prices the field by its odds,
-- seed or rank, or reports it has no order. A released event's tiers and prices are locked, so
-- there the label alone changes and nothing moves under a contest.
UPDATE "sport_event_participant_valuations" v
SET "sport_event_tier_id" = NULL, "tier_order_index" = NULL, "tier_assigned_source" = NULL
FROM "sport_event_participants" sep
JOIN "sport_events" e ON e."id" = sep."sport_event_id"
WHERE sep."id" = v."sport_event_participant_id" AND e."status" = 'DRAFT' AND v."tier_assigned_source" = 'AUTO_NAME';
UPDATE "sport_event_participant_valuations" v
SET "price" = NULL, "price_assigned_source" = NULL
FROM "sport_event_participants" sep
JOIN "sport_events" e ON e."id" = sep."sport_event_id"
WHERE sep."id" = v."sport_event_participant_id" AND e."status" = 'DRAFT' AND v."price_assigned_source" = 'AUTO_NAME';
UPDATE "sport_event_participant_valuations" SET "tier_assigned_source" = 'MANUAL' WHERE "tier_assigned_source" = 'AUTO_NAME';
UPDATE "sport_event_participant_valuations" SET "price_assigned_source" = 'MANUAL' WHERE "price_assigned_source" = 'AUTO_NAME';
CREATE TYPE "ValuationSource_new" AS ENUM ('AUTO_ODDS', 'AUTO_RANKING', 'MANUAL', 'AUTO_SEED');
ALTER TABLE "sport_event_participant_valuations" ALTER COLUMN "tier_assigned_source" TYPE "ValuationSource_new" USING ("tier_assigned_source"::text::"ValuationSource_new");
ALTER TABLE "sport_event_participant_valuations" ALTER COLUMN "price_assigned_source" TYPE "ValuationSource_new" USING ("price_assigned_source"::text::"ValuationSource_new");
ALTER TYPE "ValuationSource" RENAME TO "ValuationSource_old";
ALTER TYPE "ValuationSource_new" RENAME TO "ValuationSource";
DROP TYPE "public"."ValuationSource_old";
