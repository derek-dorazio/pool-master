-- #1999: the ingestion schedule is keyed by ProviderSyncKind, and the synthetic health check
-- is gone. A saved schedule keeps its values under the new keys; the health check's is dropped.
-- With no saved row, nothing changes: the defaults apply.
UPDATE "platform_runtime_configs"
SET "config_json" = jsonb_strip_nulls(jsonb_build_object(
      'EVENTS', "config_json" -> 'eventList',
      'FIELD', "config_json" -> 'eventParticipants',
      'SCORES', "config_json" -> 'eventLiveScores'
    )),
    "updated_at" = NOW()
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG';
