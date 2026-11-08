-- The contest started and final results emails are built by background jobs (#1387).
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'CONTEST_STARTED_EMAILS';
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'CONTEST_SETTLED_EMAILS';
