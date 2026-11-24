-- League model 1c (#2038): the sync finding a Provider that keeps rate limiting raises.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'PROVIDER_RATE_LIMITED' BEFORE 'UNMAPPED_PARTICIPANT';
