-- League model 16 part A2 (#2015): a draft field contest whose first slot's teams were still
-- undecided at its cutoff can never open, and raises this finding. An enum value only.

-- AlterEnum
ALTER TYPE "PrismaProviderSyncFindingKind" ADD VALUE 'FIELD_CONTEST_CANNOT_OPEN';
