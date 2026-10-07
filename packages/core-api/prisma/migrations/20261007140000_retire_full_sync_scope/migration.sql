-- #435 — retire the provider-owned FULL sync scope (ADR-0009).
--
-- A FULL event let a field sync overwrite its name, venue, dates, rounds and timing and move
-- its status, and its admin could not edit it. Every event is now admin-owned:
--   1. A FULL event got each round from the first score for it. Admin-owned events get rounds
--      from the admin's round schedule, so each FULL event with a known round count gets the
--      default schedule (one round a day from its start), skipping rounds that already exist.
--   2. Each FULL event has automatic lifecycle turned off. The lifecycle scheduler never moved a
--      FULL event, and stale ones sit in SCHEDULED or IN_PROGRESS with past dates; left on, the
--      first sweep after deploy would activate and settle their contests and email members. An
--      admin turns it back on from the event's Workflow card.
--   3. Each FULL event becomes SCORES_ONLY when it is linked to a provider event, or NONE when
--      it carries the manual-admin placeholder identity.
--   4. FULL leaves the enum, and the column default becomes NONE, matching every admin create.

-- 1. Default round schedule for FULL events.
INSERT INTO "sport_event_rounds" ("sport_event_id", "round_number", "scheduled_date", "updated_at")
SELECT e."id", n.round_number, e."start_date" + ((n.round_number - 1) * INTERVAL '1 day'), now()
FROM "sport_events" e
CROSS JOIN LATERAL generate_series(1, e."rounds") AS n(round_number)
WHERE e."sync_scope" = 'FULL'
  AND e."rounds" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "sport_event_rounds" r
    WHERE r."sport_event_id" = e."id" AND r."round_number" = n.round_number
  );

-- 2. Keep the lifecycle scheduler off former FULL events, as it always was.
UPDATE "sport_events" SET "auto_lifecycle_enabled" = false WHERE "sync_scope" = 'FULL';

-- 3. Backfill.
UPDATE "sport_events"
SET "sync_scope" = CASE
  WHEN "provider_id" = 'manual-admin' THEN 'NONE'::"PrismaSportEventSyncScope"
  ELSE 'SCORES_ONLY'::"PrismaSportEventSyncScope"
END
WHERE "sync_scope" = 'FULL';

-- 4. Drop FULL and change the default.
ALTER TABLE "sport_events" ALTER COLUMN "sync_scope" DROP DEFAULT;
ALTER TYPE "PrismaSportEventSyncScope" RENAME TO "PrismaSportEventSyncScope_old";
CREATE TYPE "PrismaSportEventSyncScope" AS ENUM ('NONE', 'SCORES_ONLY');
ALTER TABLE "sport_events"
  ALTER COLUMN "sync_scope" TYPE "PrismaSportEventSyncScope"
  USING ("sync_scope"::text::"PrismaSportEventSyncScope");
DROP TYPE "PrismaSportEventSyncScope_old";
ALTER TABLE "sport_events" ALTER COLUMN "sync_scope" SET DEFAULT 'NONE';
