-- #126 — retire the EVENTSCHEDULE and EVENTRESULTS feeds.
--
-- Deleted, not demoted: an admin creates every event and moves its lifecycle by hand, so a
-- scheduled discovery of the provider's schedule has nothing left to do, and EVENTRESULTS only
-- ever fetched a payload and discarded it. Final standings come from the scores EVENTLIVESCORES
-- already delivered.
--
-- Neither feed type is a Postgres enum: both live only inside provider_sync_runs.payload_json,
-- which the sync-run history serves through a contract whose feed enum no longer has them. So
-- the history is brought in line with the contract, as #125 did for PARTICIPANTRANKINGS:
--   1. Runs OF a retired feed (one row per feed, `requestedFeed`) are deleted. Every whole-sport
--      run was an EVENTSCHEDULE run, so this also removes the last sport-scoped rows.
--   2. Runs of another feed submitted in the same request keep their row and lose the retired
--      values from their `requestedFeeds` list.
--
-- Data only: no schema change. The persisted ingestion schedule config drops its
-- `eventSchedule` and `eventResults` policies on boot (ingestion-config-service.ts).

DELETE FROM "provider_sync_runs"
WHERE "payload_json"->>'requestedFeed' IN ('EVENTSCHEDULE', 'EVENTRESULTS');

UPDATE "provider_sync_runs"
SET "payload_json" = jsonb_set(
  "payload_json",
  '{requestedFeeds}',
  (
    SELECT COALESCE(jsonb_agg(feed), '[]'::jsonb)
    FROM jsonb_array_elements("payload_json"->'requestedFeeds') AS feed
    WHERE feed NOT IN ('"EVENTSCHEDULE"'::jsonb, '"EVENTRESULTS"'::jsonb)
  )
)
WHERE jsonb_typeof("payload_json"->'requestedFeeds') = 'array'
  AND (
    "payload_json"->'requestedFeeds' @> '["EVENTSCHEDULE"]'::jsonb
    OR "payload_json"->'requestedFeeds' @> '["EVENTRESULTS"]'::jsonb
  );
