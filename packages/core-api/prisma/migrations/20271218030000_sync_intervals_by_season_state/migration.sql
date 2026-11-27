-- League model 10c part B (#2009): each sync kind runs on an interval per Season state, in season
-- (one of the league's Seasons' spans holds now) and off season, and the FIELD sync's look-ahead
-- days go (it syncs the league's next slot). A saved schedule keeps each kind's switch, and its
-- interval becomes the in-season one; off season the events and field syncs run daily and live
-- scores keep their interval. With no saved row, nothing changes: the code defaults apply.
UPDATE "platform_runtime_configs"
SET "config_json" = (
      SELECT jsonb_object_agg(kind.key, jsonb_strip_nulls(jsonb_build_object(
        'enabled', kind.value -> 'enabled',
        'intervals', jsonb_build_object(
          'IN_SEASON', kind.value - 'enabled' - 'lookaheadDays',
          'OFFSEASON', CASE WHEN kind.key = 'SCORES'
            THEN kind.value - 'enabled' - 'lookaheadDays'
            ELSE '{"intervalMinutes": 1440}'::jsonb END
        )
      )))
      FROM jsonb_each("config_json") AS kind
      WHERE kind.key IN ('EVENTS', 'FIELD', 'SCORES')
    ),
    "updated_at" = NOW()
WHERE "config_key" = 'INGESTION_SCHEDULE_CONFIG'
  AND "config_json" ?| ARRAY['EVENTS', 'FIELD', 'SCORES']
  AND NOT COALESCE(("config_json" -> 'EVENTS') ? 'intervals', false);
