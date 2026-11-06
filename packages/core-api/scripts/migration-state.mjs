/**
 * How a database's recorded migration history compares with the migrations a tree carries.
 *
 * Dependency-free on purpose: the cloud session-start hook imports it before `npm ci` has run,
 * and the QA reset and migrate scripts import it alongside @prisma/client.
 */

/**
 * `inImage` is the migration directory names; `recorded` is `_prisma_migrations` rows
 * (`migration_name`, `finished_at`, `rolled_back_at`, nulls where unset).
 *
 * - `missing`: in the tree, not applied.
 * - `unexpected`: applied, not in the tree: the history was squashed or rewritten.
 * - `unfinished`: started but never finished, or rolled back: Prisma's P3009 state.
 */
export function compareMigrationState(inImage, recorded) {
  const applied = recorded.filter((row) => row.finished_at !== null && row.rolled_back_at === null)
    .map((row) => row.migration_name);
  const appliedSet = new Set(applied);
  const imageSet = new Set(inImage);
  return {
    missing: inImage.filter((name) => !appliedSet.has(name)),
    unexpected: applied.filter((name) => !imageSet.has(name)),
    unfinished: recorded
      .filter((row) => row.finished_at === null || row.rolled_back_at !== null)
      .map((row) => row.migration_name),
  };
}
