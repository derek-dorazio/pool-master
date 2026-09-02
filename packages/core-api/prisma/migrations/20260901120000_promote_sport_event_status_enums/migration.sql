-- plans/124-golf-admin-tournament-management.md §4.1 (folds pool-master-5xi.1).
--
-- SportEvent.status: promote bare String to PrismaSportEventStatus. OFFICIAL is
-- dropped (never written outside the EVENTRESULTS/ProviderEventResult pipeline
-- plans/125 deletes); remap any existing OFFICIAL rows to COMPLETED first so the
-- type conversion never fails.
--
-- SportEventParticipant.status: replace the free-text 7-value status with a
-- boolean isActive gate + an optional PrismaGolfParticipantInactiveReason,
-- matching what the real write path already produces (a binary ACTIVE/INACTIVE
-- outcome from sync; WITHDRAWN/CUT/ELIMINATED only ever came from a
-- not-yet-built admin edit). PROVISIONAL/ALTERNATE/INACTIVE (as a reason) are
-- dropped, not carried forward.

CREATE TYPE "PrismaSportEventStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'POSTPONED');
CREATE TYPE "PrismaGolfParticipantInactiveReason" AS ENUM ('WITHDRAWN', 'CUT', 'ELIMINATED');

UPDATE "sport_events" SET "status" = 'COMPLETED' WHERE "status" = 'OFFICIAL';

ALTER TABLE "sport_events"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaSportEventStatus"
  USING "status"::"PrismaSportEventStatus";

ALTER TABLE "sport_events"
  ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';

ALTER TABLE "sport_event_participants"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "inactive_reason" "PrismaGolfParticipantInactiveReason";

UPDATE "sport_event_participants"
SET
  "is_active" = CASE WHEN "status" IN ('WITHDRAWN', 'CUT', 'ELIMINATED', 'INACTIVE') THEN false ELSE true END,
  "inactive_reason" = CASE "status"
    WHEN 'WITHDRAWN' THEN 'WITHDRAWN'::"PrismaGolfParticipantInactiveReason"
    WHEN 'CUT' THEN 'CUT'::"PrismaGolfParticipantInactiveReason"
    WHEN 'ELIMINATED' THEN 'ELIMINATED'::"PrismaGolfParticipantInactiveReason"
    ELSE NULL
  END
WHERE "status" IS NOT NULL;

ALTER TABLE "sport_event_participants" DROP COLUMN "status";
