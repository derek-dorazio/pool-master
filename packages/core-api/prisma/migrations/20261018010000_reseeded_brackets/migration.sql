-- Reseeded brackets (#722): a sport league says how its bracket winners reach their next match,
-- and a match names the region or conference it is in.
CREATE TYPE "PrismaBracketAdvancement" AS ENUM ('FIXED', 'RESEED_BY_SEED');

ALTER TABLE "sport_leagues" ADD COLUMN "bracket_advancement" "PrismaBracketAdvancement" NOT NULL DEFAULT 'FIXED';

ALTER TABLE "sport_event_matches" ADD COLUMN "region_label" VARCHAR(40);
