-- An event's contests are settled by a background job, not in the request that finished it (#1448).
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'SETTLE_SPORT_EVENT_CONTESTS';
