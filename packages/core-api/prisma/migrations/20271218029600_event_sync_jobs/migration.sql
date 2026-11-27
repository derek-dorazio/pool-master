-- League model 10c (#2009): an event's field and its scores each sync on a job of their own,
-- queued by the one sync tick, by a provider's webhook and by a root admin's Sync now alike, and
-- carrying only our own ids. The two job types they replace go: MANUAL_EVENT_SYNC (Sync now) and
-- PROVIDER_EVENT_SYNC (a webhook's). Their jobs, queued or finished, go with the values; their
-- sync runs stay in the sync history, which never pointed at a job row.
DELETE FROM "background_jobs" WHERE "type" IN ('MANUAL_EVENT_SYNC', 'PROVIDER_EVENT_SYNC');
CREATE TYPE "PrismaBackgroundJobType_new" AS ENUM ('SYNC_EVENT_FIELD', 'SYNC_EVENT_SCORES', 'CONTEST_STARTED_EMAILS', 'CONTEST_SETTLED_EMAILS', 'CONTEST_EVENT_CHANGED_EMAILS', 'SETTLE_SPORT_EVENT_CONTESTS', 'SETTLE_GAME_CONTESTS', 'REBUILD_LEADERBOARDS', 'CONTEST_REOPENED_EMAILS', 'SYNC_LEAGUE_EVENTS', 'RELEASE_SPORT_EVENT', 'SYNC_EVENT_GAMES_AND_TIERS', 'ACTIVATE_EVENT_CONTESTS', 'FOLLOW_POSTPONED_EVENT_CONTESTS', 'RESOLVE_MAPPED_PARTICIPANT_FINDINGS', 'REFRESH_SLOT_TIEBREAKERS');
ALTER TABLE "background_jobs" ALTER COLUMN "type" TYPE "PrismaBackgroundJobType_new" USING ("type"::text::"PrismaBackgroundJobType_new");
ALTER TYPE "PrismaBackgroundJobType" RENAME TO "PrismaBackgroundJobType_old";
ALTER TYPE "PrismaBackgroundJobType_new" RENAME TO "PrismaBackgroundJobType";
DROP TYPE "PrismaBackgroundJobType_old";
