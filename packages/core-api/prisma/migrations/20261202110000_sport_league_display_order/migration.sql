-- Where a sport league sits among its sport's leagues wherever they are listed together: How to
-- Play's chips list the major professional leagues first, then the NCAA's, not alphabetically.
-- Lower comes first; null comes after every ordered league, by name.
ALTER TABLE "sport_leagues" ADD COLUMN "display_order" INTEGER;

-- Every seeded sport league, and US Thoroughbred, which loading horse racing's data creates.
-- Reference data, as their display names are.
UPDATE "sport_leagues" l SET "display_order" = orders."display_order", "updated_at" = NOW()
FROM "sports" s, (VALUES
  ('AMERICAN_FOOTBALL', 'NFL', 10),
  ('AMERICAN_FOOTBALL', 'College Football Playoff', 20),
  ('BASKETBALL', 'NBA', 10),
  ('BASKETBALL', 'WNBA', 20),
  ('BASKETBALL', 'NCAA Division I Men', 30),
  ('BASKETBALL', 'NCAA Division I Women', 40),
  ('BASEBALL', 'MLB', 10),
  ('HOCKEY', 'NHL', 10),
  ('HOCKEY', 'PWHL', 20),
  ('HOCKEY', 'NCAA Division I Men', 30),
  ('HOCKEY', 'NCAA Division I Women', 40),
  ('SOCCER', 'FIFA World Cup', 10),
  ('SOCCER', 'Premier League', 20),
  ('SOCCER', 'UEFA Champions League', 30),
  ('SOCCER', 'MLS', 40),
  ('SOCCER', 'FIFA Women''s World Cup', 50),
  ('SOCCER', 'NWSL', 60),
  ('SOCCER', 'UEFA European Championship', 70),
  ('SOCCER', 'Copa América', 80),
  ('SOCCER', 'NCAA Division I Men', 90),
  ('SOCCER', 'NCAA Division I Women', 100),
  ('GOLF', 'PGA TOUR', 10),
  ('GOLF', 'LPGA Tour', 20),
  ('AUTO_RACING', 'NASCAR Cup Series', 10),
  ('AUTO_RACING', 'Formula 1', 20),
  ('AUTO_RACING', 'IndyCar', 30),
  ('TENNIS', 'ATP', 10),
  ('TENNIS', 'WTA', 20),
  ('TENNIS', 'NCAA Division I Men', 30),
  ('TENNIS', 'NCAA Division I Women', 40),
  ('HORSE_RACING', 'US Thoroughbred', 10),
  ('CYCLING', 'UCI WorldTour', 10),
  ('CYCLING', 'UCI Women''s WorldTour', 20),
  ('RUNNING', 'World Marathon Majors (men)', 10),
  ('RUNNING', 'World Marathon Majors (women)', 20)
) AS orders("sport", "name", "display_order")
WHERE l."sport_id" = s."id" AND s."sport"::text = orders."sport" AND l."name" = orders."name";
