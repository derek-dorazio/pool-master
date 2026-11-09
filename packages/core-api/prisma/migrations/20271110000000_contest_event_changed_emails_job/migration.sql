-- The event postponed, moved and cancelled emails are built by a background job per contest (#1458).
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'CONTEST_EVENT_CHANGED_EMAILS';
