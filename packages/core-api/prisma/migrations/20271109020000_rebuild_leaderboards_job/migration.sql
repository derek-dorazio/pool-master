-- Stored live leaderboards are rebuilt by a background job, not on the task that took the write (#1463).
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'REBUILD_LEADERBOARDS';
