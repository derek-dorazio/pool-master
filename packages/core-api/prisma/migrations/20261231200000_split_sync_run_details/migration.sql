-- #1174: a sync run's detailed diagnostics move out of the summary payload into their own
-- column, so the sync history lists runs without them and the nightly cleanup can clear them.
ALTER TABLE "provider_sync_runs" ADD COLUMN "details_json" JSONB;

UPDATE "provider_sync_runs"
SET
  "details_json" = (
    SELECT jsonb_object_agg("key", "value")
    FROM jsonb_each("payload_json")
    WHERE "key" IN ('providerPayload', 'jobPayload', 'writeDiagnostics', 'failurePayload')
  ),
  "payload_json" = "payload_json" - ARRAY['providerPayload', 'jobPayload', 'writeDiagnostics', 'failurePayload']
WHERE "payload_json" ?| ARRAY['providerPayload', 'jobPayload', 'writeDiagnostics', 'failurePayload'];
