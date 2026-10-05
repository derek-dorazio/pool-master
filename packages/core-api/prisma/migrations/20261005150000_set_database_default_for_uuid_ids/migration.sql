-- #340 — reconcile `schema.prisma` with the migration history.
--
-- The schema declared `@default(uuid())` on every uuid `id`, which Prisma generates
-- application-side and which leaves the column with NO database default. Five tables
-- had nonetheless acquired `DEFAULT gen_random_uuid()` in earlier migrations, so the
-- schema and the deployed database disagreed about those five.
--
-- The ruling (#340 decision 1) is to extend the database default to every uuid `id`
-- rather than drop the five, so raw SQL inserts — reference-data migrations and
-- bootstrap scripts — no longer have to supply an id by hand. `gen_random_uuid()` is
-- built into Postgres 13+ (QA runs 16), so no extension is required.
--
-- The 32 statements below are exactly the tables that lacked the default; the five that
-- already carried it (event_series, participant_league_affiliations,
-- participant_ranking_snapshots, sport_event_rounds, sport_leagues) are deliberately
-- absent. `sport_leagues.name` and `match_keyword` gained `@db.VarChar(255)` in the
-- schema in the same change and produce no DDL here — the columns already are
-- varchar(255); only the schema was silent about it.
--
-- Generated with `prisma migrate diff --from-url <migrated db>
-- --to-schema-datamodel prisma/schema.prisma --script`, not by hand.

-- AlterTable
ALTER TABLE "contest_config_templates" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "contest_configurations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "contest_entries" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "contest_entry_golf_standings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "contest_entry_picks" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "contest_entry_standings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "contest_prize_definitions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "contests" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "draft_pick_histories" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "draft_sessions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "league_invitations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "league_memberships" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "leagues" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "participant_contest_scoring_rules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "participant_provider_mappings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "participants" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "platform_runtime_configs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "provider_sync_runs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sport_event_participant_golf_rounds" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sport_event_participant_golf_standings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sport_event_participant_rounds" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sport_event_participant_standings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sport_event_participant_valuations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sport_event_participants" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sport_event_tiers" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sport_events" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sports" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "squad_memberships" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "squad_owner_invitations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "squads" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

