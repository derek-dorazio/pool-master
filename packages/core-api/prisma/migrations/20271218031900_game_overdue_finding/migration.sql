-- A Game whose result is overdue (#2013): the sync tick raises it in place of the event's overdue chip.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'GAME_OVERDUE';
