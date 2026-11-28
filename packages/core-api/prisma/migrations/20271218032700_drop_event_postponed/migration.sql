-- League model slice 14 part 2d (#2013): postponement belongs to the Game, which the feed marks
-- POSTPONED, and an event's status derives from its slots. The event-level POSTPONED status goes,
-- and with it the FOLLOW_POSTPONED_EVENT_CONTESTS job that followed a postponed event's start.
-- A postponed event goes back to SCHEDULED; its next slot refresh or lifecycle sweep moves it on
-- from there. Its follow jobs, queued or finished, go with the value.
UPDATE "sport_events" SET "status" = 'SCHEDULED' WHERE "status" = 'POSTPONED';
ALTER TABLE "sport_events" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "PrismaSportEventStatus_new" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
ALTER TABLE "sport_events" ALTER COLUMN "status" TYPE "PrismaSportEventStatus_new" USING ("status"::text::"PrismaSportEventStatus_new");
ALTER TYPE "PrismaSportEventStatus" RENAME TO "PrismaSportEventStatus_old";
ALTER TYPE "PrismaSportEventStatus_new" RENAME TO "PrismaSportEventStatus";
DROP TYPE "PrismaSportEventStatus_old";
ALTER TABLE "sport_events" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';

DELETE FROM "background_jobs" WHERE "type" = 'FOLLOW_POSTPONED_EVENT_CONTESTS';
CREATE TYPE "PrismaBackgroundJobType_new" AS ENUM ('SYNC_EVENT_FIELD', 'SYNC_EVENT_SCORES', 'CONTEST_STARTED_EMAILS', 'CONTEST_SETTLED_EMAILS', 'CONTEST_EVENT_CHANGED_EMAILS', 'SETTLE_SPORT_EVENT_CONTESTS', 'SETTLE_GAME_CONTESTS', 'REBUILD_LEADERBOARDS', 'CONTEST_REOPENED_EMAILS', 'SYNC_LEAGUE_EVENTS', 'RELEASE_SPORT_EVENT', 'SYNC_EVENT_GAMES_AND_TIERS', 'ACTIVATE_EVENT_CONTESTS', 'RESOLVE_MAPPED_PARTICIPANT_FINDINGS', 'REFRESH_SLOT_TIEBREAKERS', 'SYNC_LEAGUE_ROSTER', 'REFRESH_SLOT_STATUS', 'REFRESH_EVENT_STATUS', 'CLOSE_LEAGUE_CHAMPIONSHIP_YEAR', 'CLOSE_SEASON_CHAMPIONSHIP_YEARS');
ALTER TABLE "background_jobs" ALTER COLUMN "type" TYPE "PrismaBackgroundJobType_new" USING ("type"::text::"PrismaBackgroundJobType_new");
ALTER TYPE "PrismaBackgroundJobType" RENAME TO "PrismaBackgroundJobType_old";
ALTER TYPE "PrismaBackgroundJobType_new" RENAME TO "PrismaBackgroundJobType";
DROP TYPE "PrismaBackgroundJobType_old";
