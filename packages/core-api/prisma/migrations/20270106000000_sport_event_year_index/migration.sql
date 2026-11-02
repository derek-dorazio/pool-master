-- #1377: the root admin Events page lists one year's events across every sport. The
-- (event_series_id, event_year) unique key leads on the series, so that read had no index
-- leading on the year and scanned every event.
CREATE INDEX "sport_events_event_year_idx" ON "sport_events"("event_year");
