-- #1823: a synced DRAFT event is released on its own once every ready check passes, within its
-- sport league's window before the start. Each try is one RELEASE_SPORT_EVENT background job.
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'RELEASE_SPORT_EVENT';

-- Every league starts with a 7-day window; null turns automatic release off for the league.
ALTER TABLE "sport_leagues" ADD COLUMN "auto_release_days_before_start" INTEGER DEFAULT 7;
ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_auto_release_days_before_start_range"
  CHECK ("auto_release_days_before_start" IS NULL OR "auto_release_days_before_start" BETWEEN 1 AND 30);
