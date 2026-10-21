-- #834: what screens call a sport league when its sport's noun does not fit. Null takes the
-- sport's noun: tennis's sport leagues are tours, which the ATP and the WTA are and the NCAA's
-- championships are not.
CREATE TYPE "PrismaSportLeagueNoun" AS ENUM ('LEAGUE');

ALTER TABLE "sport_leagues" ADD COLUMN "noun" "PrismaSportLeagueNoun";

-- The NCAA Division I men's and women's tennis championships are leagues. Reference data, as
-- their round names are.
UPDATE "sport_leagues" l SET "noun" = 'LEAGUE', "updated_at" = NOW()
FROM "sports" s
WHERE l."sport_id" = s."id" AND s."sport" = 'TENNIS' AND l."name" IN ('NCAA Division I Men', 'NCAA Division I Women');
