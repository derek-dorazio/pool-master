-- #1807: tiers and prices share one field order, decided by odds, then seed, then rank, then name.
-- An automatic tier or price records the value that decided it.
ALTER TYPE "ValuationSource" ADD VALUE 'AUTO_SEED';
ALTER TYPE "ValuationSource" ADD VALUE 'AUTO_NAME';
