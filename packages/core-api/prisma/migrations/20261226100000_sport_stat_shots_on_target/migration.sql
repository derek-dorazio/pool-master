-- #994: soccer's Hat Trick counts shots on target, a stat no other composite counts. Goals and
-- assists are the values hockey and basketball already store.
ALTER TYPE "PrismaSportStat" ADD VALUE 'SHOTS_ON_TARGET' AFTER 'SHOTS_ON_GOAL';
