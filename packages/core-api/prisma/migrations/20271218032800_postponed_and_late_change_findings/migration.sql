-- A postponed Game with no new date, and a completed slot whose Matches changed (#2013): two
-- findings, raised by the sync tick and the slot status refresh.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'GAME_POSTPONED_NO_DATE';
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'SLOT_CHANGED_AFTER_COMPLETED';
