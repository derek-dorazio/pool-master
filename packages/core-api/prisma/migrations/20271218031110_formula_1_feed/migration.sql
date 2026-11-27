-- #2045 (league model 10d): Formula 1 is synced from BALLDONTLIE's F1 API.
--
-- 1. BALLDONTLIE's F1 league. The vendor publishes no F1 notifications, so it subscribes to none
--    and is synced on the schedule only. A Grand Prix's race runs about two hours; a feed silent
--    for three hours while it is under way is quiet.
-- 2. The Formula 1 sport league mapped to it. The mapping is not selected here: as with every other
--    league, a root admin turns the league's sync on by selecting it on the league's settings,
--    once the key's plan includes the sessions and results it reads.
-- 3. Each Grand Prix slot matched by its name (NAME_PATTERN), the way golf's tournaments are: the
--    sync links the Season slot to the vendor's event id on first match. São Paulo also matches its
--    name written without the accent.
-- 4. The league's Seasons by the vendor's season number, which is the year.
-- 5. Only the Race session is played (plan §3, Derek 2026-11-22): a Grand Prix's one Round is its
--    race, and practice, qualifying and the sprint are not synced.

INSERT INTO "provider_leagues" ("provider_id", "code", "name", "sport_id", "webhook_event_set", "quiet_after_minutes", "typical_game_minutes", "updated_at")
SELECT '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11', 'f1', 'Formula 1', s."id", 'NONE', 180, 120, now()
FROM "sports" s
WHERE s."sport" = 'AUTO_RACING';

INSERT INTO "sport_league_provider_mappings" ("sport_league_id", "provider_league_id", "updated_at")
SELECT '7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37', pl."id", now()
FROM "provider_leagues" pl
WHERE pl."provider_id" = '6f1e9a52-3b7d-4c1a-9e2f-0d5b8a7c4e11' AND pl."code" = 'f1';

INSERT INTO "sport_league_competition_slot_provider_mappings" ("sport_league_id", "sport_league_competition_slot_id", "sport_league_provider_mapping_id", "match_type", "provider_value", "updated_at")
SELECT slot."sport_league_id", slot."id", m."id", 'NAME_PATTERN', v.pattern, now()
FROM (VALUES
  ('ABU_DHABI_GRAND_PRIX', 'abu dhabi grand prix'),
  ('AUSTRALIAN_GRAND_PRIX', 'australian grand prix'),
  ('AUSTRIAN_GRAND_PRIX', 'austrian grand prix'),
  ('AZERBAIJAN_GRAND_PRIX', 'azerbaijan grand prix'),
  ('BAHRAIN_GRAND_PRIX', 'bahrain grand prix'),
  ('BARCELONA_CATALUNYA_GRAND_PRIX', 'barcelona-catalunya grand prix'),
  ('BELGIAN_GRAND_PRIX', 'belgian grand prix'),
  ('BRITISH_GRAND_PRIX', 'british grand prix'),
  ('CANADIAN_GRAND_PRIX', 'canadian grand prix'),
  ('CHINESE_GRAND_PRIX', 'chinese grand prix'),
  ('DUTCH_GRAND_PRIX', 'dutch grand prix'),
  ('HUNGARIAN_GRAND_PRIX', 'hungarian grand prix'),
  ('ITALIAN_GRAND_PRIX', 'italian grand prix'),
  ('JAPANESE_GRAND_PRIX', 'japanese grand prix'),
  ('LAS_VEGAS_GRAND_PRIX', 'las vegas grand prix'),
  ('MEXICO_CITY_GRAND_PRIX', 'mexico city grand prix'),
  ('MIAMI_GRAND_PRIX', 'miami grand prix'),
  ('MONACO_GRAND_PRIX', 'monaco grand prix'),
  ('QATAR_GRAND_PRIX', 'qatar grand prix'),
  ('SAUDI_ARABIAN_GRAND_PRIX', 'saudi arabian grand prix'),
  ('SINGAPORE_GRAND_PRIX', 'singapore grand prix'),
  ('SPANISH_GRAND_PRIX', 'spanish grand prix'),
  ('S_O_PAULO_GRAND_PRIX', 'são paulo grand prix'),
  ('S_O_PAULO_GRAND_PRIX', 'sao paulo grand prix'),
  ('UNITED_STATES_GRAND_PRIX', 'united states grand prix')
) AS v(key, pattern)
JOIN "sport_league_competition_slots" slot ON slot."sport_league_id" = '7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37' AND slot."key" = v.key
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = slot."sport_league_id"
JOIN "provider_leagues" pl ON pl."id" = m."provider_league_id" AND pl."code" = 'f1';

INSERT INTO "sport_league_season_provider_mappings" ("sport_league_id", "sport_league_season_id", "sport_league_provider_mapping_id", "provider_season_id", "updated_at")
SELECT season."sport_league_id", season."id", m."id", season."championship_year"::text, now()
FROM "sport_league_seasons" season
JOIN "sport_league_provider_mappings" m ON m."sport_league_id" = season."sport_league_id"
JOIN "provider_leagues" pl ON pl."id" = m."provider_league_id" AND pl."code" = 'f1'
WHERE season."sport_league_id" = '7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37';

INSERT INTO "sport_league_provider_session_type_mappings" ("sport_league_id", "sport_league_provider_mapping_id", "provider_session_type", "updated_at")
SELECT m."sport_league_id", m."id", 'Race', now()
FROM "sport_league_provider_mappings" m
JOIN "provider_leagues" pl ON pl."id" = m."provider_league_id" AND pl."code" = 'f1'
WHERE m."sport_league_id" = '7ec9d58e-cfa0-4f8e-b7b5-1986cce18d37';
