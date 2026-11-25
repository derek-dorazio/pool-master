-- League model slice 8b (#2005): a league whose selected provider mapping names a provider league
-- code its Provider does not read raises an ERROR finding, instead of the adapter reading every
-- league of the sport or nothing without a word.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'PROVIDER_LEAGUE_UNKNOWN';
