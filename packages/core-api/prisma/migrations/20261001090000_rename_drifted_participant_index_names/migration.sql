-- #254 — four indexes carried names that differ from the ones Prisma derives from the schema,
-- so `prisma migrate diff` reported them on every run. Three were written longer than 63 bytes
-- and truncated by Postgres, which cuts the tail, where Prisma keeps the `_key`/`_idx` suffix
-- and cuts the column segment; the fourth was hand-shortened. The target names are copied from
-- `prisma migrate diff` against a database migrated from main, not derived by hand.
--
-- RENAME, not drop-and-create: these back live unique constraints, and a drop-and-create would
-- leave a window with no enforcement. A rename is a catalog update; the index is not rebuilt.

-- RenameIndex
ALTER INDEX "participant_league_affiliations_participant_id_sport_leag_key" RENAME TO "participant_league_affiliations_participant_id_sport_league_key";

-- RenameIndex
ALTER INDEX "participant_ranking_snapshots_participant_id_ranking_type_as_o_" RENAME TO "participant_ranking_snapshots_participant_id_ranking_type_a_idx";

-- RenameIndex
ALTER INDEX "participant_ranking_snapshots_provider_id_participant_id_ranki_" RENAME TO "participant_ranking_snapshots_provider_id_participant_id_ra_key";

-- RenameIndex
ALTER INDEX "participant_ranking_snapshots_provider_id_ranking_type_as_of_id" RENAME TO "participant_ranking_snapshots_provider_id_ranking_type_as_o_idx";
