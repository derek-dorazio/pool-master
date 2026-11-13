-- ADR 0011 (#1725): the provider whose sync creates a sport league's events. Null for every
-- league until a root admin turns a league's sync on.
ALTER TABLE "sport_leagues" ADD COLUMN "event_sync_provider_id" VARCHAR(100);
