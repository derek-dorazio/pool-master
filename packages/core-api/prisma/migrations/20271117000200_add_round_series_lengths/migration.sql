-- Each round's best-of length, first to final (#1545), lined up with the event's last round as
-- round_names is. A game-score sync counts a series' wins against it. Empty plays single games.
ALTER TABLE "sport_leagues" ADD COLUMN "round_series_lengths" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- A series is an odd number of games, so one side always wins more than half.
ALTER TABLE "sport_leagues" ADD CONSTRAINT sport_leagues_round_series_lengths_check
  CHECK (round_series_lengths <@ ARRAY[1, 3, 5, 7, 9]);

-- The playoff formats, by the league's own round names:
-- NBA and NHL: every round best of seven.
UPDATE sport_leagues SET round_series_lengths = ARRAY[7, 7, 7, 7], updated_at = now()
WHERE name = 'NBA' AND sport_id = (SELECT id FROM sports WHERE sport = 'BASKETBALL');
UPDATE sport_leagues SET round_series_lengths = ARRAY[7, 7, 7, 7], updated_at = now()
WHERE name = 'NHL' AND sport_id = (SELECT id FROM sports WHERE sport = 'HOCKEY');
-- WNBA (from 2025): First Round best of three, Semifinals and WNBA Finals best of seven.
UPDATE sport_leagues SET round_series_lengths = ARRAY[3, 7, 7], updated_at = now()
WHERE name = 'WNBA' AND sport_id = (SELECT id FROM sports WHERE sport = 'BASKETBALL');
-- MLS Cup Playoffs: Round One best of three; the Wild Card and every later round one game.
UPDATE sport_leagues SET round_series_lengths = ARRAY[1, 3, 1, 1, 1], updated_at = now()
WHERE name = 'MLS' AND sport_id = (SELECT id FROM sports WHERE sport = 'SOCCER');
