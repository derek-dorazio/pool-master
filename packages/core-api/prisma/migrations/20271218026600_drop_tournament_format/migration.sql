-- Whether an event plays matches is read from its slots' match format (#2008), so the sport's
-- tournament format has no reader left.
ALTER TABLE "sports" DROP COLUMN "tournament_format";

DROP TYPE "PrismaTournamentFormat";
