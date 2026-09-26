-- plans/145-one-object-one-operation-set.md step 3.1 (#202). Two changes, both
-- prescribed by rules/domain-model-conventions-rules.md §12.
--
-- 1. Squad names are unique within a league.
--
--    §12 has stated this since it was written; nothing enforced it. The
--    constraint covers ALL squads in the league, active and inactive, so an
--    inactivated squad continues to hold its name. That is deliberate: a
--    partial unique index over `is_active` cannot be expressed in the Prisma
--    schema, so it would read as drift on every `prisma migrate diff`, and a
--    commissioner already has the hard delete that frees the name.
--
--    No de-duplication step precedes the index. Per
--    rules/model-change-rules.md "No-Data Clean Reworks" there is no
--    persistent production data, and dev/test/CI rows reset on reseed. If a
--    non-dev database does hold two squads with one name in a league, this
--    migration fails loudly on that database rather than silently renaming a
--    user's squad — which is the correct failure, and the reset is the answer
--    the convention prescribes.
--
-- 2. `leagues.created_by` is dropped.
--
--    It was a bare uuid column with no relation — no referential integrity, no
--    traversal. `LeagueMembership` with `role = COMMISSIONER` is the
--    authoritative record of who runs a league (§12), and `createLeague`
--    writes that membership in the same operation as the league itself.
--
--    It was NOT pure provenance, contrary to how this was first recorded: the
--    user hard-delete dependency guards in admin/user-service.ts and
--    account/service.ts both counted `league.createdBy = userId`. That count
--    is redundant — the same guards already count the user's
--    LeagueMembership rows, and a creator always has one. The only case
--    `created_by` added was a user who created a league and was later removed
--    from it, who under §12 has no remaining relationship to it. The
--    `LEAGUE_CREATOR` dependency type goes with the column.
--
--    `squads.created_by` is unaffected. It is a real relation
--    (@relation("SquadCreatedBy")) and stays.

-- CreateIndex
CREATE UNIQUE INDEX "squads_league_id_name_key"
  ON "squads"("league_id", "name");

-- AlterTable
ALTER TABLE "leagues" DROP COLUMN "created_by";
