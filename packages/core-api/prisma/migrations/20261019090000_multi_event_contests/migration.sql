-- Multi-event contests (#713): a contest covers one or more events through contest_sport_events,
-- and an entry's draft/submitted status is per event (contest_entry_events). Every existing
-- contest keeps its one event as sequence 1, every entry its status for that event, and every
-- settled standing its copy as that event's standing. The old columns are dropped last.

-- CreateTable
CREATE TABLE "contest_sport_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "sport_event_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_sport_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_entry_id" UUID NOT NULL,
    "sport_event_id" UUID NOT NULL,
    "status" "PrismaContestEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entry_event_standings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contest_id" UUID NOT NULL,
    "contest_entry_id" UUID NOT NULL,
    "sport_event_id" UUID NOT NULL,
    "position" INTEGER,
    "display_position" VARCHAR(20),
    "counting_pick_limit" INTEGER NOT NULL,
    "scored_pick_count" INTEGER NOT NULL,
    "total_score" INTEGER,
    "as_of" TIMESTAMPTZ,
    "settled_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_event_standings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contest_sport_events_sport_event_id_idx" ON "contest_sport_events"("sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_sport_events_contest_id_sport_event_id_key" ON "contest_sport_events"("contest_id", "sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_sport_events_contest_id_sequence_key" ON "contest_sport_events"("contest_id", "sequence");

-- CreateIndex
CREATE INDEX "contest_entry_events_sport_event_id_idx" ON "contest_entry_events"("sport_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_events_contest_entry_id_sport_event_id_key" ON "contest_entry_events"("contest_entry_id", "sport_event_id");

-- CreateIndex
CREATE INDEX "contest_entry_event_standings_contest_id_sport_event_id_pos_idx" ON "contest_entry_event_standings"("contest_id", "sport_event_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entry_event_standings_contest_entry_id_sport_event__key" ON "contest_entry_event_standings"("contest_entry_id", "sport_event_id");

-- AddForeignKey
ALTER TABLE "contest_sport_events" ADD CONSTRAINT "contest_sport_events_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_sport_events" ADD CONSTRAINT "contest_sport_events_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_events" ADD CONSTRAINT "contest_entry_events_contest_entry_id_fkey" FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_events" ADD CONSTRAINT "contest_entry_events_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_event_standings" ADD CONSTRAINT "contest_entry_event_standings_contest_id_fkey" FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_event_standings" ADD CONSTRAINT "contest_entry_event_standings_contest_entry_id_fkey" FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_entry_event_standings" ADD CONSTRAINT "contest_entry_event_standings_sport_event_id_fkey" FOREIGN KEY ("sport_event_id") REFERENCES "sport_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each contest's one event becomes its first (and only) covered event.
INSERT INTO "contest_sport_events" ("contest_id", "sport_event_id", "sequence", "created_at")
SELECT "id", "sport_event_id", 1, "created_at"
FROM "contests"
WHERE "sport_event_id" IS NOT NULL;

-- Each entry's status becomes its status for that event. A submitted entry's submit time was
-- never stored, so its last update stands in for it.
INSERT INTO "contest_entry_events" ("contest_entry_id", "sport_event_id", "status", "submitted_at", "created_at", "updated_at")
SELECT e."id", c."sport_event_id", e."status",
       CASE WHEN e."status" = 'SUBMITTED' THEN e."updated_at" END,
       e."created_at", e."updated_at"
FROM "contest_entries" e
JOIN "contests" c ON c."id" = e."contest_id"
WHERE c."sport_event_id" IS NOT NULL;

-- A settled single-event contest's total is also its one event's result.
INSERT INTO "contest_entry_event_standings" (
    "contest_id", "contest_entry_id", "sport_event_id", "position", "display_position",
    "counting_pick_limit", "scored_pick_count", "total_score", "as_of", "settled_at", "created_at", "updated_at"
)
SELECT s."contest_id", s."contest_entry_id", c."sport_event_id", s."position", s."display_position",
       s."counting_pick_limit", s."scored_pick_count", s."total_score", s."as_of", s."settled_at", s."created_at", s."updated_at"
FROM "contest_entry_standings" s
JOIN "contests" c ON c."id" = s."contest_id"
WHERE c."sport_event_id" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "contests" DROP CONSTRAINT "contests_sport_event_id_fkey";

-- DropIndex
DROP INDEX "contests_sport_event_id_idx";

-- AlterTable
ALTER TABLE "contest_entries" DROP COLUMN "status";

-- AlterTable
ALTER TABLE "contests" DROP COLUMN "sport_event_id";
