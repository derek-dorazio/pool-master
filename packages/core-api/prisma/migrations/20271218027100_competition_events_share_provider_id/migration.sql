-- League model slice 13b (#2154): a provider event whose games reach several competitions of a
-- Season (a season's slate of college football games reaches its bowls, its conference title
-- games and its CFP) makes one event per competition, and each holds the provider's id for the
-- slate. No event crosses competitions, so the id is no longer unique to one event.
DROP INDEX "sport_event_provider_mappings_provider_id_external_id_key";
CREATE INDEX "sport_event_provider_mappings_provider_id_external_id_idx" ON "sport_event_provider_mappings"("provider_id", "external_id");

-- A competition's own proper name names the event the sync makes for it.
ALTER TABLE "sport_league_competitions" ADD COLUMN "name" VARCHAR(100);

UPDATE "sport_league_competitions" c SET "name" = v.name, "updated_at" = now()
FROM (VALUES
  ('CFP', 'College Football Playoff'),
  ('BOWLS', 'Bowl Games'),
  ('CONFERENCE_CHAMPIONSHIPS', 'Conference Championships')
) AS v(code, name)
WHERE c."sport_league_id" = '37b259d2-b681-4ca5-94d4-894d5e9bcc10' AND c."code" = v.code;
