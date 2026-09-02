-- plans/124-golf-admin-tournament-management.md §4.6b.
--
-- Drops the legacy per-contest tier/price table now that every reader has
-- been rewired onto SportEventGolfTier + SportEventParticipantGolfValuation
-- (the event-owned tables, plans/124 §4.5): drafts/routes.ts's deriveTierConfig
-- and price reads, the admin event browser, and the contest-entry-completed
-- email's tier grouping all now resolve through golf-tier-service. This
-- table drop was deliberately sequenced AFTER that rewiring landed, not
-- alongside the new tables' creation — see the create migration's own
-- header note (20260902090000_add_golf_tier_valuation_tables).
--
-- No backfill needed — per this repo's established no-production-data
-- clean-rework convention, there is no data in this table to preserve.

-- DropTable (drops its own FK constraint and indexes along with it; nothing
-- else references this table).
DROP TABLE "sport_event_participant_valuations";
