-- #2047: a field row's seed and odds are typed columns already (seed_number, odds_to_win); the
-- provider's extras it also stored are read by no one, so the column goes.
ALTER TABLE "sport_event_participants" DROP COLUMN "metadata";
