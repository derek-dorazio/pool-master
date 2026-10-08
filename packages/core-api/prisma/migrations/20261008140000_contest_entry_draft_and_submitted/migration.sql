-- #481: an entry is a DRAFT until its owner submits a valid lineup, and only SUBMITTED entries
-- count on the leaderboard, in standings and at settlement. New entries start as DRAFT.
--
-- The type is rebuilt rather than altered in place: a value added with ALTER TYPE ... ADD VALUE
-- cannot be used (here, as the column default) in the same transaction that added it.
--
-- Existing ACTIVE entries are backfilled by where their contest stands:
--   * a contest that has started or finished (DRAFTING, LOCKED, ACTIVE, COMPLETED, CANCELLED):
--     SUBMITTED, so live and settled results do not change;
--   * a contest that has not started (DRAFT, OPEN): SUBMITTED only when the lineup is complete,
--     so members who already finished stay in; any other entry becomes DRAFT, because no
--     incomplete entry may be in play at tee-off. Its owner fills it and presses Submit.
-- "Complete" is the submit rule: a budget contest's roster_size picks; a tiered contest's
-- picksPerTier picks from every one of its event's tiers, and nothing else. Every other
-- selection type has no submit, so its unstarted entries become DRAFT.

CREATE TYPE "PrismaContestEntryStatus_new" AS ENUM ('DRAFT', 'SUBMITTED', 'INACTIVE');

ALTER TABLE "contest_entries"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PrismaContestEntryStatus_new"
    USING (CASE "status"::text WHEN 'ACTIVE' THEN 'SUBMITTED' ELSE "status"::text END)::"PrismaContestEntryStatus_new",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "PrismaContestEntryStatus";
ALTER TYPE "PrismaContestEntryStatus_new" RENAME TO "PrismaContestEntryStatus";

UPDATE "contest_entries" e
SET "status" = 'DRAFT'
FROM "contests" c
LEFT JOIN "contest_configurations" cc ON cc."contest_id" = c."id"
WHERE e."contest_id" = c."id"
  AND e."status" = 'SUBMITTED'
  AND c."status" IN ('DRAFT', 'OPEN')
  -- COALESCE: a missing roster or picksPerTier makes the check NULL, which must read as incomplete.
  AND NOT COALESCE((
    (
      c."selection_type" = 'BUDGET_PICK'
      AND COALESCE(cc."roster_size", 0) > 0
      AND (SELECT COUNT(*) FROM "contest_entry_picks" p WHERE p."entry_id" = e."id") = cc."roster_size"
    )
    OR (
      c."selection_type" = 'TIERED'
      AND jsonb_typeof(cc."config_json") = 'object'
      AND jsonb_typeof(cc."config_json"->'picksPerTier') = 'number'
      AND (cc."config_json"->>'picksPerTier')::int > 0
      AND EXISTS (SELECT 1 FROM "sport_event_tiers" t WHERE t."sport_event_id" = c."sport_event_id")
      AND (SELECT COUNT(*) FROM "contest_entry_picks" p WHERE p."entry_id" = e."id")
        = (SELECT COUNT(*) FROM "sport_event_tiers" t WHERE t."sport_event_id" = c."sport_event_id")
          * (cc."config_json"->>'picksPerTier')::int
      AND NOT EXISTS (
        SELECT 1
        FROM "sport_event_tiers" t
        WHERE t."sport_event_id" = c."sport_event_id"
          AND (
            SELECT COUNT(*)
            FROM "contest_entry_picks" p
            JOIN "sport_event_participant_valuations" v
              ON v."sport_event_participant_id" = p."sport_event_participant_id"
            WHERE p."entry_id" = e."id" AND v."sport_event_tier_id" = t."id"
          ) <> (cc."config_json"->>'picksPerTier')::int
      )
    )
  ), false);
