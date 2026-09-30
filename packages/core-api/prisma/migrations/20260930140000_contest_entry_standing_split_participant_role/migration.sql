-- #246 (slice 3c). One transaction — Prisma wraps each migration file in one.
--
-- 1. The contest entry standing splits into a cross-sport core, contest_entry_standings, and
--    a golf extension, following #240's split of the event standing: copy, then reshape. Every
--    core row takes the id of the golf row it was copied from, and the golf row keeps its own
--    id and points at the core row with that same id, so an existing standing's id survives on
--    both sides.
--    - status is dropped: settlement only ever wrote the literal 'FINAL' and nothing read it.
--    - counting_pick_count becomes counting_pick_limit: it holds the rule's N, not a count.
--    - total_score_to_par is the one golf-specific column and stays on the extension.
--    The extension cascades from the core row, so deleting an entry (which cascades to its core
--    standing) still removes the whole standing, as it did before the split.
-- 2. participants.position becomes role: it holds a playing role ("GOLFER"); position means
--    rank on both standing tables.
-- 3. Every golf-event contest configuration without an active participant scoring rule gets
--    GOLF_RELATIVE_TO_PAR_TOTAL — the exact definition the leaderboard's fallback returned for
--    them — so the fallback can be deleted with no observable change. Non-golf and event-less
--    configurations get nothing: no scoring definition exists for them, and the golf
--    leaderboard already refuses them.

-- 1. Contest entry standing: core + golf extension.
CREATE TABLE "contest_entry_standings" (
    "id" UUID NOT NULL,
    "contest_id" UUID NOT NULL,
    "contest_entry_id" UUID NOT NULL,
    "position" INTEGER,
    "display_position" VARCHAR(20),
    "counting_pick_limit" INTEGER NOT NULL,
    "scored_pick_count" INTEGER NOT NULL,
    "as_of" TIMESTAMPTZ,
    "settled_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contest_entry_standings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "contest_entry_standings"
  ("id", "contest_id", "contest_entry_id", "position", "display_position", "counting_pick_limit",
   "scored_pick_count", "as_of", "settled_at", "created_at", "updated_at")
SELECT "id", "contest_id", "contest_entry_id", "position", "display_position", "counting_pick_count",
       "scored_pick_count", "as_of", "settled_at", "created_at", "updated_at"
FROM "contest_entry_golf_standings";

CREATE UNIQUE INDEX "contest_entry_standings_contest_entry_id_key"
  ON "contest_entry_standings"("contest_entry_id");
CREATE INDEX "contest_entry_standings_contest_id_position_idx"
  ON "contest_entry_standings"("contest_id", "position");
ALTER TABLE "contest_entry_standings"
  ADD CONSTRAINT "contest_entry_standings_contest_id_fkey"
  FOREIGN KEY ("contest_id") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contest_entry_standings"
  ADD CONSTRAINT "contest_entry_standings_contest_entry_id_fkey"
  FOREIGN KEY ("contest_entry_id") REFERENCES "contest_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contest_entry_golf_standings" ADD COLUMN "contest_entry_standing_id" UUID;
UPDATE "contest_entry_golf_standings" SET "contest_entry_standing_id" = "id";
ALTER TABLE "contest_entry_golf_standings" ALTER COLUMN "contest_entry_standing_id" SET NOT NULL;

ALTER TABLE "contest_entry_golf_standings" DROP CONSTRAINT "contest_entry_golf_standings_contest_id_fkey";
ALTER TABLE "contest_entry_golf_standings" DROP CONSTRAINT "contest_entry_golf_standings_contest_entry_id_fkey";
DROP INDEX "contest_entry_golf_standings_contest_entry_id_key";
DROP INDEX "contest_entry_golf_standings_contest_id_position_idx";
DROP INDEX "contest_entry_golf_standings_status_idx";
ALTER TABLE "contest_entry_golf_standings"
  DROP COLUMN "contest_id",
  DROP COLUMN "contest_entry_id",
  DROP COLUMN "position",
  DROP COLUMN "display_position",
  DROP COLUMN "counting_pick_count",
  DROP COLUMN "scored_pick_count",
  DROP COLUMN "status",
  DROP COLUMN "as_of",
  DROP COLUMN "settled_at";

CREATE UNIQUE INDEX "contest_entry_golf_standings_contest_entry_standing_id_key"
  ON "contest_entry_golf_standings"("contest_entry_standing_id");
ALTER TABLE "contest_entry_golf_standings"
  ADD CONSTRAINT "contest_entry_golf_standings_contest_entry_standing_id_fkey"
  FOREIGN KEY ("contest_entry_standing_id") REFERENCES "contest_entry_standings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Participant.position → role. A rename, not drop-and-add: the values survive.
ALTER TABLE "participants" RENAME COLUMN "position" TO "role";

-- 3. A scoring rule on every golf-event configuration that lacks an active one.
INSERT INTO "participant_contest_scoring_rules"
  ("id", "contest_configuration_id", "participant_scoring_definition_id", "sort_order", "config",
   "active", "created_at", "updated_at")
SELECT gen_random_uuid(), cc."id", 'GOLF_RELATIVE_TO_PAR_TOTAL',
       COALESCE((SELECT MAX(r."sort_order") FROM "participant_contest_scoring_rules" r
                 WHERE r."contest_configuration_id" = cc."id"), 0) + 1,
       '{}'::jsonb, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "contest_configurations" cc
JOIN "contests" c ON c."id" = cc."contest_id"
JOIN "sport_events" se ON se."id" = c."sport_event_id"
WHERE se."sport" = 'GOLF'
  AND NOT EXISTS (
    SELECT 1 FROM "participant_contest_scoring_rules" r
    WHERE r."contest_configuration_id" = cc."id" AND r."active" = true
  );
