-- League model slice 13 (#2012): games the events sync places in a slot dated outside their
-- Season's span raise a WARNING, and are still written.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'SLOT_OUTSIDE_SEASON';

-- Games whose feed names no place for them, and which no Season slot's date window holds, raise
-- an INFO and are not synced (inclusion only).
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'GAMES_UNPLACED';

-- A Season still open or to come whose date-window slots have no window, or only a tentative one,
-- raises a WARNING that resolves once every such window is confirmed.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'SLOT_DATES_NEEDED';
