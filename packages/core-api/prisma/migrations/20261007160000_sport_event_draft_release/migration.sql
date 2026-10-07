-- #431 — an event is prepared as a DRAFT and released for contests by an admin.
--
-- Release used to be time-based (release_at) and the field lock likewise (field_locks_at, or
-- the provider's field_locked flag). Both are replaced by explicit status: DRAFT until an admin
-- releases the event, SCHEDULED or later once released, and the event's start time as the
-- contest cutoff. Existing events keep their status, so every one already counts as released.

-- 1. The new first lifecycle status.
ALTER TYPE "PrismaSportEventStatus" ADD VALUE 'DRAFT' BEFORE 'SCHEDULED';

-- 2. The timing columns release replaces.
ALTER TABLE "sport_events"
  DROP COLUMN "release_at",
  DROP COLUMN "field_locks_at",
  DROP COLUMN "field_locked";
