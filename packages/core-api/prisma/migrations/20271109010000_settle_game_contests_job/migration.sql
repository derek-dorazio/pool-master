-- A game's squares contests are settled by a background job, not in the request that decided it.
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'SETTLE_GAME_CONTESTS';
