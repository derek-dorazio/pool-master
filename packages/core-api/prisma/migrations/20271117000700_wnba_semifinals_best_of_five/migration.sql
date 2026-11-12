-- #1496: the WNBA's Semifinals are a best of five. The 2025 format made only the Finals a best
-- of seven; 20271117000200 seeded the Semifinals as seven, so a series won three games to one
-- or two would never be recorded. Only the seeded value is corrected.
UPDATE sport_leagues SET round_series_lengths = ARRAY[3, 5, 7], updated_at = now()
WHERE name = 'WNBA' AND round_series_lengths = ARRAY[3, 7, 7]
  AND sport_id = (SELECT id FROM sports WHERE sport = 'BASKETBALL');
