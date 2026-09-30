-- plans/145 slice 3, #244. A contest-level pricing method was written and echoed back but
-- never read by any client, and it could not express a field that is part auto-priced and part
-- hand-priced. Provenance is recorded per competitor by
-- sport_event_participant_valuations.price_assigned_source / tier_assigned_source.
-- The value set is kept as narrative in plans/128 §4a.
ALTER TABLE "contest_configurations" DROP COLUMN "pricing_method";
