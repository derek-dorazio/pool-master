-- League model 1b (#1998): the old Clutch Card leagues and everything of theirs go. Clutch Cards
-- come back as a contest type on their parent league's events (league model slice 26), so
-- nothing here is migrated: their rows are deleted, then the columns, the stat line table and the
-- COMPOSITE scoring family are dropped. Every old Clutch Card league is scored by COMPOSITE and
-- names a parent league; the rows are found by either, so a row that has only one goes too.

CREATE TEMP TABLE old_clutch_card_leagues AS
  SELECT id FROM sport_leagues
  WHERE scoring_family = 'COMPOSITE' OR parent_sport_league_id IS NOT NULL;

CREATE TEMP TABLE old_clutch_card_events AS
  SELECT e.id FROM sport_events e
  JOIN event_series s ON s.id = e.event_series_id
  WHERE s.sport_league_id IN (SELECT id FROM old_clutch_card_leagues)
  UNION
  SELECT id FROM sport_events WHERE parent_event_id IS NOT NULL;

CREATE TEMP TABLE old_clutch_card_templates AS
  SELECT id FROM contest_config_templates
  WHERE sport_league_id IN (SELECT id FROM old_clutch_card_leagues);

CREATE TEMP TABLE old_clutch_card_contests AS
  SELECT contest_id AS id FROM contest_sport_events
  WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events)
  UNION
  SELECT contest_id FROM contest_configurations
  WHERE template_id IN (SELECT id FROM old_clutch_card_templates);

CREATE TEMP TABLE old_clutch_card_participants AS
  SELECT id FROM participants WHERE sport_league_id IN (SELECT id FROM old_clutch_card_leagues);

CREATE TEMP TABLE old_clutch_card_field AS
  SELECT id FROM sport_event_participants
  WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events)
     OR participant_id IN (SELECT id FROM old_clutch_card_participants);

-- Their contests. Rows of an entry or a contest that cascade go with it; the rest go first.
DELETE FROM contest_entry_picks
  WHERE entry_id IN (SELECT id FROM contest_entries WHERE contest_id IN (SELECT id FROM old_clutch_card_contests));
DELETE FROM contest_entries WHERE contest_id IN (SELECT id FROM old_clutch_card_contests);
DELETE FROM participant_contest_scoring_rules
  WHERE contest_configuration_id IN (SELECT id FROM contest_configurations WHERE contest_id IN (SELECT id FROM old_clutch_card_contests));
DELETE FROM contest_prize_definitions
  WHERE contest_configuration_id IN (SELECT id FROM contest_configurations WHERE contest_id IN (SELECT id FROM old_clutch_card_contests));
DELETE FROM contest_configurations WHERE contest_id IN (SELECT id FROM old_clutch_card_contests);
DELETE FROM contests WHERE id IN (SELECT id FROM old_clutch_card_contests);

-- Their events: results, field, rounds and tiers first.
DELETE FROM sport_event_participant_stat_lines
  WHERE participant_round_id IN (SELECT id FROM sport_event_participant_rounds WHERE sport_event_participant_id IN (SELECT id FROM old_clutch_card_field));
DELETE FROM sport_event_participant_golf_rounds
  WHERE participant_round_id IN (SELECT id FROM sport_event_participant_rounds WHERE sport_event_participant_id IN (SELECT id FROM old_clutch_card_field));
DELETE FROM sport_event_participant_rounds WHERE sport_event_participant_id IN (SELECT id FROM old_clutch_card_field);
DELETE FROM sport_event_participant_golf_standings
  WHERE standing_id IN (SELECT id FROM sport_event_participant_standings WHERE sport_event_participant_id IN (SELECT id FROM old_clutch_card_field));
DELETE FROM sport_event_participant_standings WHERE sport_event_participant_id IN (SELECT id FROM old_clutch_card_field);
DELETE FROM sport_event_participant_valuations WHERE sport_event_participant_id IN (SELECT id FROM old_clutch_card_field);
DELETE FROM sport_event_matches WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events);
DELETE FROM sport_event_participants WHERE id IN (SELECT id FROM old_clutch_card_field);
DELETE FROM sport_event_rounds WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events);
DELETE FROM sport_event_tiers WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events);
DELETE FROM contest_entry_event_standings WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events);
DELETE FROM contest_entry_events WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events);
DELETE FROM contest_sport_events WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events);
DELETE FROM background_jobs
  WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events) OR sport_league_id IN (SELECT id FROM old_clutch_card_leagues);
DELETE FROM provider_sync_runs
  WHERE sport_event_id IN (SELECT id FROM old_clutch_card_events) OR sport_league_id IN (SELECT id FROM old_clutch_card_leagues);
DELETE FROM sport_events WHERE id IN (SELECT id FROM old_clutch_card_events);

-- The leagues and what is theirs: series, players, setups and event page offers. Cups cascade.
DELETE FROM event_series WHERE sport_league_id IN (SELECT id FROM old_clutch_card_leagues);
DELETE FROM participant_provider_mappings
  WHERE sport_league_id IN (SELECT id FROM old_clutch_card_leagues) OR participant_id IN (SELECT id FROM old_clutch_card_participants);
DELETE FROM participants WHERE id IN (SELECT id FROM old_clutch_card_participants);
CREATE TEMP TABLE old_clutch_card_primary_pages AS
  SELECT DISTINCT event_page_id FROM event_page_offers
  WHERE is_primary AND (sport_league_id IN (SELECT id FROM old_clutch_card_leagues) OR template_id IN (SELECT id FROM old_clutch_card_templates));
DELETE FROM event_page_offers
  WHERE sport_league_id IN (SELECT id FROM old_clutch_card_leagues) OR template_id IN (SELECT id FROM old_clutch_card_templates);
DELETE FROM contest_config_templates WHERE id IN (SELECT id FROM old_clutch_card_templates);
DELETE FROM sport_leagues WHERE id IN (SELECT id FROM old_clutch_card_leagues);

-- An event page whose primary offer was a Clutch Card's (Championship Weekend) is dated by its
-- first remaining offer instead.
UPDATE event_page_offers SET is_primary = true
  WHERE id IN (
    SELECT DISTINCT ON (o.event_page_id) o.id FROM event_page_offers o
    WHERE o.event_page_id IN (SELECT event_page_id FROM old_clutch_card_primary_pages)
    ORDER BY o.event_page_id, o.sort_order
  );

-- The columns, the stat line table and the stat enum.
ALTER TABLE "sport_events" DROP CONSTRAINT "sport_events_parent_with_rounds";
ALTER TABLE "sport_events" DROP CONSTRAINT "sport_events_parent_event_id_fkey";
DROP INDEX "sport_events_parent_event_id_idx";
ALTER TABLE "sport_events" DROP COLUMN "parent_event_id", DROP COLUMN "parent_round_numbers";

ALTER TABLE "sport_leagues" DROP CONSTRAINT "sport_leagues_parent_rounds_need_parent_league";
ALTER TABLE "sport_leagues" DROP CONSTRAINT "sport_leagues_parent_sport_league_id_fkey";
DROP INDEX "sport_leagues_parent_sport_league_id_idx";
ALTER TABLE "sport_leagues" DROP COLUMN "parent_sport_league_id", DROP COLUMN "parent_round_numbers";

DROP TABLE "sport_event_participant_stat_lines";
DROP TYPE "PrismaSportStat";

-- COMPOSITE leaves the scoring family enum: Postgres drops an enum value only by recreating the type.
ALTER TYPE "PrismaScoringFamily" RENAME TO "PrismaScoringFamily_old";
CREATE TYPE "PrismaScoringFamily" AS ENUM ('STROKE_PLAY', 'FINISH_POSITION', 'HEAD_TO_HEAD');
ALTER TABLE "sport_leagues" ALTER COLUMN "scoring_family" TYPE "PrismaScoringFamily" USING ("scoring_family"::text::"PrismaScoringFamily");
DROP TYPE "PrismaScoringFamily_old";

DROP TABLE old_clutch_card_primary_pages, old_clutch_card_field, old_clutch_card_participants, old_clutch_card_contests, old_clutch_card_templates, old_clutch_card_events, old_clutch_card_leagues;
