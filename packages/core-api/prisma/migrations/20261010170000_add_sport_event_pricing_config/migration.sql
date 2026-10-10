-- Budget pricing (#93): the values an event's field was priced with. Null until prices are
-- assigned; locked with the prices at release.
ALTER TABLE "sport_events" ADD COLUMN "pricing_config" JSONB;
