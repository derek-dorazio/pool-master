-- Contests going live at an event's start, and a postponed event's contests following its start, run as background jobs (#1952).
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'ACTIVATE_EVENT_CONTESTS';
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'FOLLOW_POSTPONED_EVENT_CONTESTS';
