-- League model 10f (#2047): a game's periods are its slot definition's period unit and count
-- (5b, #2043, which backfilled them from this column and each sport's layout). Nothing reads the
-- sport league's layout any more.
ALTER TABLE "sport_leagues" DROP COLUMN "match_period_layout";

DROP TYPE "PrismaMatchPeriodLayout";
