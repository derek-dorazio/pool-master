-- #1847: the root admin's Sports page reads each sport league's sync health and issues.

-- A sport event's latest automatic release check: when, released or held, and the checks that
-- held it. Until now a hold was only a log line, so nothing could count them.
CREATE TYPE "PrismaAutoReleaseCheckOutcome" AS ENUM ('RELEASED', 'HELD');

CREATE TYPE "PrismaReleaseCheckKey" AS ENUM ('NOT_STARTED', 'ROUNDS_SCHEDULED', 'FIELD_LOADED', 'FIELD_LINKED', 'TIERS_ASSIGNED', 'TIERS_FILLED', 'PRICES_ASSIGNED', 'BRACKET_COMPLETE', 'CONTEST_SETUPS_ON');

ALTER TABLE "sport_events" ADD COLUMN     "auto_release_checked_at" TIMESTAMPTZ,
ADD COLUMN     "auto_release_failed_checks" "PrismaReleaseCheckKey"[] DEFAULT ARRAY[]::"PrismaReleaseCheckKey"[],
ADD COLUMN     "auto_release_outcome" "PrismaAutoReleaseCheckOutcome";

-- The time and outcome are set together, and a release has no failed checks.
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_auto_release_check_complete"
  CHECK (("auto_release_checked_at" IS NULL) = ("auto_release_outcome" IS NULL));
ALTER TABLE "sport_events" ADD CONSTRAINT "sport_events_auto_release_released_has_no_failed_checks"
  CHECK ("auto_release_outcome" IS DISTINCT FROM 'RELEASED' OR cardinality("auto_release_failed_checks") = 0);

-- Each sport league's latest run of each sync kind.
CREATE INDEX "provider_sync_runs_sport_league_id_kind_created_at_idx" ON "provider_sync_runs"("sport_league_id", "kind", "created_at" DESC);

-- A field or scores run now records its event and that event's sport league whenever the
-- provider event is linked to one of ours. Runs already written get them the same way.
UPDATE "provider_sync_runs" AS "run"
SET "sport_event_id" = "event"."id",
    "sport_league_id" = "series"."sport_league_id"
FROM "sport_events" AS "event"
JOIN "event_series" AS "series" ON "series"."id" = "event"."event_series_id"
WHERE "run"."kind" IN ('FIELD', 'SCORES')
  AND "run"."sport_league_id" IS NULL
  AND "run"."event_id" IS NOT NULL
  AND "event"."provider_id" = "run"."provider_id"
  AND "event"."external_id" = "run"."event_id";
