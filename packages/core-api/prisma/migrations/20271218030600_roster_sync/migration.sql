-- League model 21 part B (#2025): the roster sync, a sync kind of its own with a job per league.
-- A saved schedule needs no change: a stored settings value is read over the group's defaults, so
-- its missing ROSTER policy reads as the default, and the settings history reads its changes the
-- same way, so they stay as they were saved.
ALTER TYPE "PrismaProviderSyncKind" ADD VALUE 'ROSTER';
ALTER TYPE "PrismaBackgroundJobType" ADD VALUE 'SYNC_LEAGUE_ROSTER';
