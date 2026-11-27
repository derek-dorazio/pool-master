-- #2223: a released rest-of-phase event (a season's bowls) holding an active team none of whose
-- games is placed in its slots any more is a sync finding, raised and resolved by the field sync.
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'FIELD_TEAM_WITHOUT_GAME';
