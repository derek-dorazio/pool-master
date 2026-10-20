-- A sport league can play its games in other periods than its sport's (#786): men's college
-- basketball plays two halves where the NBA, the WNBA and women's college basketball play four
-- quarters. Null plays the sport's layout.
CREATE TYPE "PrismaMatchPeriodLayout" AS ENUM ('QUARTERS', 'HALVES');

ALTER TABLE "sport_leagues" ADD COLUMN "match_period_layout" "PrismaMatchPeriodLayout";
