-- #706: a sport league may name its bracket's rounds, first to final, where the sport's names do
-- not fit it: the NBA's four rounds are not March Madness's last four. Empty keeps the sport's.
ALTER TABLE "sport_leagues" ADD COLUMN "round_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
