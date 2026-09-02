-- plans/124-golf-admin-tournament-management.md §3.6/§4.10/§9 item 11.
--
-- SportEventRound holds a tournament round's own schedule (date/end),
-- independent of any participant — genuinely different from
-- SportEventParticipantGolfRound, which holds one golfer's result for a
-- round. SportEventParticipantGolfRound.round (a bare, unvalidated Int) is
-- replaced by a real FK to SportEventRound: this is a clean rework, not an
-- additive change — per this repo's established no-production-data
-- convention (the same one plan 117's own substrate migration used), there
-- is no data in sport_event_participant_golf_rounds to preserve.
--
-- Also seeds the one "system" User row that scheduler-driven AdminAuditEntry
-- writes attribute to (AdminAuditEntry.actorId is a required FK to User).

-- CreateTable
CREATE TABLE "sport_event_rounds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sport_event_id" UUID NOT NULL,
  "round_number" INTEGER NOT NULL,
  "scheduled_date" TIMESTAMPTZ NOT NULL,
  "scheduled_end_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,

  CONSTRAINT "sport_event_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sport_event_rounds_sport_event_id_round_number_key"
  ON "sport_event_rounds"("sport_event_id", "round_number");

-- AddForeignKey
ALTER TABLE "sport_event_rounds"
  ADD CONSTRAINT "sport_event_rounds_sport_event_id_fkey"
  FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "sport_events" ADD COLUMN "auto_lifecycle_enabled" BOOLEAN NOT NULL DEFAULT true;

-- DropForeignKey (the old bare-Int round column had no FK to drop; this is
-- the unique index on it)
DROP INDEX IF EXISTS "sport_event_participant_golf_rounds_sport_event_participant_key";

-- AlterTable: clean rework, no backfill — see header note.
ALTER TABLE "sport_event_participant_golf_rounds"
  DROP COLUMN "round",
  ADD COLUMN "sport_event_round_id" UUID NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "sep_golf_rounds_sep_id_round_id_key"
  ON "sport_event_participant_golf_rounds"("sport_event_participant_id", "sport_event_round_id");

-- AddForeignKey
ALTER TABLE "sport_event_participant_golf_rounds"
  ADD CONSTRAINT "sep_golf_rounds_round_id_fkey"
  FOREIGN KEY ("sport_event_round_id") REFERENCES "sport_event_rounds"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the system actor user for scheduler-driven AdminAuditEntry rows.
INSERT INTO "users" ("id", "email", "username", "first_name", "last_name", "is_active", "is_root_admin", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000000', 'system@poolmaster.internal', 'system', 'PoolMaster', 'System', true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
