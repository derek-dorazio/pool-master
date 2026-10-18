-- #707: a sport league may set how many tiers a new event of its starts with, where the sport's
-- default does not fit its field: the College Football Playoff's 12 teams over football's seven
-- tiers (built for the NFL's 14) would leave two tiers of one team. Null keeps the sport's.
ALTER TABLE "sport_leagues" ADD COLUMN "tier_count" INTEGER;
-- At least one tier: an event with none could hold no tiered contest.
ALTER TABLE "sport_leagues" ADD CONSTRAINT "sport_leagues_tier_count_positive" CHECK ("tier_count" IS NULL OR "tier_count" >= 1);
