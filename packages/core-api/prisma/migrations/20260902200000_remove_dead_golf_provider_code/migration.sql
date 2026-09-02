-- plans/124-golf-admin-tournament-management.md §4.11 ("Unrelated cleanup
-- riding along with this epic"). Beads: pool-master-w3x.
--
-- Three genuinely-dead schema/contract artefacts, each re-verified against
-- current main before removal (grep for real call sites, not just the
-- declaration):
--
--  * PrismaSport enum — orphaned. Not the type of any column since
--    participant_season_records (its only ever consumer) was dropped in
--    20260506211309_substrate_redesign_phase4_foundation. Zero references in
--    packages/core-api/src or packages/shared. PrismaSportCategory is the enum
--    actually wired to Sport.category.
--
--  * contest_sport_events — the speculative M:N Contest<->SportEvent join
--    (plans/117) built ahead of multi-event contest types that were never
--    built. Zero production writers; the only reads were defensive fallbacks
--    that only made sense while the table was unpopulated, plus a
--    deletion-guard blocked-reason. A future multi-event contest epic rebuilds
--    it to whatever shape it actually needs.
--
--  * The seeded golf-category-picks ContestConfigTemplate row
--    (config_mode = 'GOLF_CATEGORY_PICKS', from
--    20260419213000_add_contest_config_templates) — GOLF_CATEGORY_PICKS is a
--    fully-typed contract with zero backend implementation. The mode, its
--    DTO schemas, and its generated-client references are removed in this same
--    slice; plans/127-golf-category-drafts.md rebuilds category picks on a
--    clean slate rather than resurrecting this stub. The row is deleted so
--    template listings stay valid against the trimmed configMode contract.
--
-- Per rules/model-change-rules.md "No-Data Clean Reworks": no persistent
-- (non-dev) database holds rows in these structures, so this is a single
-- clean drop, not a backfill/compat phase.

-- DropForeignKey
ALTER TABLE "contest_sport_events" DROP CONSTRAINT "contest_sport_events_contest_id_fkey";

-- DropForeignKey
ALTER TABLE "contest_sport_events" DROP CONSTRAINT "contest_sport_events_sport_event_id_fkey";

-- DropTable
DROP TABLE "contest_sport_events";

-- DropEnum
DROP TYPE "PrismaSport";

-- Delete the now-unservable GOLF_CATEGORY_PICKS seeded contest config template.
DELETE FROM "contest_config_templates" WHERE "config_mode" = 'GOLF_CATEGORY_PICKS';
