-- League model 3e (#2147): a sport league's name is the only name screens show (3d gave every
-- league a name that says its sport), so the second display name goes. Refuse to drop it while
-- any league still carries one, so no name a screen shows is lost silently.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sport_leagues" WHERE "display_name" IS NOT NULL) THEN
    RAISE EXCEPTION 'sport_leagues.display_name is still set on % league(s); fold it into name first',
      (SELECT COUNT(*) FROM "sport_leagues" WHERE "display_name" IS NOT NULL);
  END IF;
END $$;

ALTER TABLE "sport_leagues" DROP COLUMN "display_name";
