-- League model slice 13b (#2154): a slot can take every game in its Season window that no other
-- slot places, whoever plays it (a phase's bowls, a weekend of title games). Its own migration, as
-- a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "PrismaSlotProviderMatchType" ADD VALUE 'REST_OF_PHASE';
