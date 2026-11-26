-- A field row's place in its event is one status (#2184), in place of `is_active` and
-- `inactive_reason`. An inactive row with no reason recorded was taken out of the field, so it
-- is WITHDRAWN. DISQUALIFIED is new: no row holds it yet.
CREATE TYPE "SportEventParticipantStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'ELIMINATED', 'DISQUALIFIED');

ALTER TABLE "sport_event_participants" ADD COLUMN "status" "SportEventParticipantStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "sport_event_participants"
SET "status" = CASE
  WHEN "is_active" THEN 'ACTIVE'::"SportEventParticipantStatus"
  WHEN "inactive_reason" = 'ELIMINATED' THEN 'ELIMINATED'::"SportEventParticipantStatus"
  ELSE 'WITHDRAWN'::"SportEventParticipantStatus"
END;

ALTER TABLE "sport_event_participants" DROP COLUMN "is_active";
ALTER TABLE "sport_event_participants" DROP COLUMN "inactive_reason";
DROP TYPE "ParticipantInactiveReason";
