-- #1812: every sport league left on is one a data provider syncs. The leagues no provider covers
-- yet are switched off: inactive, not deleted, so their rows, contest setups, round names and copy
-- stay and turning one back on is one flip. An inactive league is left off How to Play, Contest
-- types, contest setup, event pages and the sync's scheduled reads. Existing events and contests
-- on them are left as they are.
--
-- Several names repeat across sports ("NCAA Division I Men" is basketball, hockey, soccer and
-- tennis, and NCAA basketball stays on), so each league is matched by its sport and its name.
-- Horse racing's leagues are not all reference data (a data file's Load can create one), so every
-- horse racing league is matched by its sport alone.
--
-- They come back with: cycling #682, the marathons #683, the soccer tournaments #1814, NASCAR and
-- IndyCar #681, horse racing #680, the rest #1815.
UPDATE sport_leagues
SET is_active = false,
    updated_at = now()
FROM sports
WHERE sports.id = sport_leagues.sport_id
  AND sport_leagues.is_active
  AND (
    sports.sport IN ('CYCLING', 'RUNNING', 'HORSE_RACING')
    OR (sports.sport = 'AUTO_RACING' AND sport_leagues.name IN ('NASCAR Cup Series', 'IndyCar'))
    OR (sports.sport = 'SOCCER' AND sport_leagues.name IN (
      'FIFA Women''s World Cup',
      'Women''s World Cup Semifinals',
      'Women''s World Cup Final',
      'UEFA European Championship',
      'Copa América',
      'NWSL',
      'NCAA Division I Men',
      'NCAA Division I Women'
    ))
    OR (sports.sport = 'HOCKEY' AND sport_leagues.name IN (
      'PWHL',
      'NCAA Division I Men',
      'NCAA Division I Women',
      'Men''s Frozen Four',
      'Men''s Hockey National Championship'
    ))
    OR (sports.sport = 'TENNIS' AND sport_leagues.name IN ('NCAA Division I Men', 'NCAA Division I Women'))
  );
