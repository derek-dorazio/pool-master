-- League model slice 13 (#2012): games the events sync places in a slot dated outside their
-- Season's span raise a WARNING, and are still written.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'SLOT_OUTSIDE_SEASON';
