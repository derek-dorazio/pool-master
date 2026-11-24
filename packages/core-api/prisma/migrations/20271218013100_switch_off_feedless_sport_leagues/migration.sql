-- League model 5c (#2072): a league with no feed stays off. These five active leagues have no
-- ProviderLeague and no SportLeagueProviderMapping, so no sync can put their events, fields or
-- results on: LPGA Tour, MLS, ATP, WTA and UEFA Champions League, by id.
--
-- Switched off, not deleted: their contest setups, event page offers and last-season test-data
-- files stay, inactive. A league comes back on by migration once a provider feeds it. Formula 1
-- stays on: its feed is being built (slice 10d).
UPDATE "sport_leagues"
SET "is_active" = false, "updated_at" = now()
WHERE "id" IN (
  'c4d2cda5-f6df-4156-8fc2-26bfb5b3352d', -- LPGA Tour
  '1d4245e7-27e5-4386-bb2f-fad87ef7b8e5', -- MLS
  '6fa88e2c-e828-40f4-9ba1-be3302e54d18', -- ATP
  '89753830-f4b5-4c3e-8f30-8dac2465061b', -- WTA
  '5e1930aa-989b-4b92-85f0-a3d604f4a546'  -- UEFA Champions League
);
