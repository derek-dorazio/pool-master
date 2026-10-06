-- #125 — retire the PARTICIPANTRANKINGS feed and the ParticipantRankingSnapshot table it wrote.
--
-- Retired, not demoted: the admin-owned ParticipantLeagueAffiliation.ranking is the one current
-- ranking, and an event field carries its own per-participant ranking (#384), so the global,
-- provider-scoped snapshot history has no reader left.
--
-- The feed type is not a Postgres enum: it lives only inside provider_sync_runs.payload_json,
-- which the sync-run history serves through a contract whose feed enum no longer has
-- PARTICIPANTRANKINGS. So the history is brought in line with the contract here:
--   1. Runs OF the retired feed (one row per feed, `requestedFeed`) are deleted.
--   2. Runs of another feed submitted in the same request keep their row and lose the retired
--      value from their `requestedFeeds` list.
--
-- The two DDL statements are generated with `prisma migrate diff --from-url <migrated db>
-- --to-schema-datamodel packages/core-api/prisma/schema.prisma --script`.

-- Sync-run history of the retired feed
DELETE FROM "provider_sync_runs"
WHERE "payload_json"->>'requestedFeed' = 'PARTICIPANTRANKINGS';

UPDATE "provider_sync_runs"
SET "payload_json" = jsonb_set(
  "payload_json",
  '{requestedFeeds}',
  (
    SELECT COALESCE(jsonb_agg(feed), '[]'::jsonb)
    FROM jsonb_array_elements("payload_json"->'requestedFeeds') AS feed
    WHERE feed <> '"PARTICIPANTRANKINGS"'::jsonb
  )
)
WHERE jsonb_typeof("payload_json"->'requestedFeeds') = 'array'
  AND "payload_json"->'requestedFeeds' @> '["PARTICIPANTRANKINGS"]'::jsonb;

-- DropForeignKey
ALTER TABLE "participant_ranking_snapshots" DROP CONSTRAINT "participant_ranking_snapshots_participant_id_fkey";

-- DropTable
DROP TABLE "participant_ranking_snapshots";
