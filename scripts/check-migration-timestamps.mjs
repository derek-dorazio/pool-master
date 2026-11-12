/**
 * #266 — no two Prisma migrations may share a timestamp prefix, for migrations a branch adds.
 *
 * Prisma orders migrations by directory name. Two directories stamped with the same
 * `YYYYMMDDHHMMSS` are ordered by their descriptions, not by intent — harmless while they touch
 * different tables, silently wrong once they touch the same one. Parallel sessions cannot see
 * each other's choice, so a collision only exists once both branches reach `main`.
 *
 * #1670 — and no migration a branch adds may be dated before the base's latest
 * (`findAddedBeforeBase`): a fresh database would apply it before that one, an environment that
 * has applied that one after it.
 *
 * WHY ONLY ADDED MIGRATIONS. The fix for a collision that has shipped is not a rename: Prisma
 * records applied migrations by name, so renaming one an environment has applied makes the old
 * name read as applied-but-missing and the new one as unapplied, and the next `migrate deploy`
 * re-runs work already done. The pre-squash history carried two such pairs, which the #1429
 * baseline replaced. So the check fails only when a migration the current change
 * adds shares its prefix with any other migration — no exception list to prune.
 *
 * WHAT "ADDED" IS MEASURED AGAINST.
 * - In CI (`CI` set), against `HEAD^1`. A `pull_request` build checks out the PR merged into the
 *   current base, whose first parent is the base tip; a push to `main` has the previous `main`
 *   as its first parent. That is why the job checks out with `fetch-depth: 2`. The push build
 *   is the backstop for a PR whose green run predates the base gaining a colliding migration.
 * - Locally, against the merge-base with `origin/main`, and the added set is compared with
 *   `origin/main`'s migrations as well — so a collision with something that landed after the
 *   branch was cut is caught before a PR is opened. Fetch `origin/main` first for that.
 * - `MIGRATION_BASE_REF` overrides both.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATIONS_DIR = 'packages/core-api/prisma/migrations';
const MIGRATION_DIR_PATTERN = /^(\d{14})_/;

export function timestampPrefix(name) {
  return MIGRATION_DIR_PATTERN.exec(name)?.[1] ?? null;
}

/**
 * Each added migration whose prefix any other known migration shares. `added` are directory
 * names the change introduces; `known` is every migration it must not collide with (the
 * working tree, and optionally the base's), and may include the added ones themselves.
 */
export function findAddedCollisions({ added, known }) {
  const byPrefix = new Map();
  for (const name of new Set([...known, ...added])) {
    const prefix = timestampPrefix(name);
    if (!prefix) continue;
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name]);
  }
  const collisions = new Map();
  for (const name of added) {
    const prefix = timestampPrefix(name);
    if (!prefix) continue;
    const sharing = byPrefix.get(prefix) ?? [];
    if (sharing.length > 1) collisions.set(prefix, [...sharing].sort());
  }
  return [...collisions.entries()].map(([prefix, names]) => ({ prefix, names }));
}

/**
 * Each added migration dated before the latest of the base's migrations (#1670), with that latest
 * one. Prisma applies migrations in name order, so a fresh database (CI's, a test reset) runs such
 * a migration before the base's later ones, while an environment that has applied those runs it
 * after them: two orders, which diverge silently once both touch one table. A migration sharing
 * the latest's timestamp is left to `findAddedCollisions`.
 */
export function findAddedBeforeBase({ added, base }) {
  const latest = [...base].filter((name) => timestampPrefix(name)).sort().at(-1);
  if (latest === undefined) return [];
  const latestPrefix = timestampPrefix(latest);
  return added
    .filter((name) => timestampPrefix(name) && timestampPrefix(name) < latestPrefix)
    .sort()
    .map((name) => ({ name, latest }));
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function migrationsAt(ref) {
  const listing = git(['ls-tree', '--name-only', `${ref}:${MIGRATIONS_DIR}`]);
  if (listing === null) return null;
  return listing.split('\n').filter((name) => timestampPrefix(name));
}

function migrationsInWorkingTree() {
  return readdirSync(MIGRATIONS_DIR).filter(
    (name) => timestampPrefix(name) && statSync(join(MIGRATIONS_DIR, name)).isDirectory(),
  );
}

/**
 * The base the added migrations are measured against, and a ref whose migrations also count as
 * the base's (see WHAT "ADDED" IS MEASURED AGAINST), or null when no merge-base with
 * `origin/main` resolves. `mergeBaseWith` answers `git merge-base HEAD <ref>`, or null.
 */
export function resolveBase(env = process.env, mergeBaseWith = (ref) => git(['merge-base', 'HEAD', ref])) {
  if (env.MIGRATION_BASE_REF) {
    return { ref: env.MIGRATION_BASE_REF, alsoKnown: null };
  }
  if (env.CI) {
    return { ref: 'HEAD^1', alsoKnown: null };
  }
  const mergeBase = mergeBaseWith('origin/main');
  return mergeBase ? { ref: mergeBase, alsoKnown: 'origin/main' } : null;
}

function main() {
  const current = migrationsInWorkingTree();
  const base = resolveBase();
  const baseMigrations = base ? migrationsAt(base.ref) : null;
  if (!base || baseMigrations === null) {
    const where = base ? `\`${base.ref}\`` : 'a merge-base with `origin/main`';
    if (process.env.CI) {
      console.error(
        `Migration timestamp check: could not read the base migrations at ${where}. `
        + 'The job needs the base commit — check out with `fetch-depth: 2`.',
      );
      process.exit(1);
    }
    console.warn(`Migration timestamp check: skipped — could not resolve ${where}. Fetch origin/main.`);
    return;
  }

  const baseSet = new Set(baseMigrations);
  const added = current.filter((name) => !baseSet.has(name));
  const alsoKnown = base.alsoKnown ? migrationsAt(base.alsoKnown) ?? [] : [];
  const collisions = findAddedCollisions({ added, known: [...current, ...alsoKnown] });
  const early = findAddedBeforeBase({ added, base: [...baseMigrations, ...alsoKnown] });

  if (collisions.length === 0 && early.length === 0) {
    console.log(`Migration timestamp check OK (${added.length} added against ${base.ref}).`);
    return;
  }
  for (const { prefix, names } of collisions) {
    console.error(`duplicate migration timestamp ${prefix}:`);
    for (const name of names) console.error(`  ${name}`);
  }
  for (const { name, latest } of early) {
    console.error(`${name} is dated before ${latest}, which main already has. Re-date it after ${latest}.`);
  }
  console.error(
    '\nGive the migration this change adds a timestamp after every migration on main, used by no '
    + 'other. Never rename one that is already on main: environments record applied migrations by name.',
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
