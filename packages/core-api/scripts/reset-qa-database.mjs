#!/usr/bin/env node
/* global console, process */
/**
 * Wipe QA's database and bring it back to this image's migrations, with its fixture users.
 *
 * plans/129 (#83) specified this and it was never built, which is why a refused migration had
 * no recovery: the migration's own header pointed at a workflow that did not exist. plans/147's
 * Season collapse then refused on QA — season-less sport_events with 11 contests on them, rows
 * the scripted repair rightly would not decide about — and the owner's answer was that QA holds
 * nothing worth preserving. This is the tool that acts on that answer, and the one that handles
 * the same situation next time without a bespoke repair.
 *
 * Only the reset half of plans/129 is built here. The migration squash, and the retirement of
 * the repair scripts that follows it, stay unbuilt — they are a separate decision.
 *
 * ## This destroys everything in the target database
 *
 * Three guards, because the destructive step is one command and the blast radius is total:
 * `DATABASE_URL` must look like the QA endpoint, `--apply` is required to act at all, and
 * `--confirm-qa-reset` is required alongside it. Default mode reports what is there and exits.
 *
 * Usage:
 *   node scripts/reset-qa-database.mjs [--apply --confirm-qa-reset]
 *
 * Environment: DATABASE_URL. FIXTURE_JSON is passed through to bootstrap-users.mjs, which runs
 * after the reset so QA comes back usable rather than merely empty; without it the reset still
 * happens and the missing users are reported as a warning.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

const SCHEMA_PATH = 'prisma/schema.prisma';
const MIGRATIONS_DIR = 'prisma/migrations';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmed = args.has('--confirm-qa-reset');

function printUsage() {
  console.log(`
Usage:
  node scripts/reset-qa-database.mjs [--apply --confirm-qa-reset]

Default mode is a read-only report: the migration history, and a row count per table.

Apply mode DESTROYS EVERY ROW in the target database:
  1. prisma migrate reset --force --skip-seed  (drops the schema, re-applies every migration)
  2. verifies the recorded history is exactly this image's migrations, all applied
  3. runs bootstrap-users.mjs with FIXTURE_JSON so QA has its fixture users back

Required apply flags:
  --apply
  --confirm-qa-reset

Afterwards the current main commit's deploy still needs to roll out: migrations gate the
rollout, so deploy-qa was skipped when the migration failed. Re-run that run's failed jobs.
`);
}

function runNode(scriptArgs, env = {}) {
  return spawnSync('node', scriptArgs, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function runPrisma(argsToRun) {
  const result = spawnSync('npx', ['prisma', ...argsToRun], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

export function assertQaDatabaseUrl(databaseUrl, allowNonQa) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }
  if (!databaseUrl.includes('poolmaster-qa-postgres') && allowNonQa !== 'true') {
    throw new Error(
      'Refusing to run: DATABASE_URL does not look like the QA RDS endpoint. '
        + 'Set ALLOW_NON_QA_RESET=true only for an explicitly reviewed non-QA reset.',
    );
  }
}

/** The migrations this image carries, in the order Prisma applies them. */
export function migrationsInImage(dir = MIGRATIONS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * What a reset is supposed to leave behind: every migration in the image, applied, and nothing
 * recorded that the image does not have. A mismatch after a reset means the image and the
 * database disagree about what exists, which is the state this tool is meant to end.
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

async function readMigrationRows(prisma) {
  try {
    return await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at, rolled_back_at
      FROM public."_prisma_migrations"
      ORDER BY started_at ASC
    `);
  } catch {
    // No _prisma_migrations table at all is a legitimate state for a reset to start from.
    return [];
  }
}

async function readRowCounts(prisma) {
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const counts = {};
  for (const { table_name: table } of tables) {
    const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM public."${table}"`);
    counts[table] = result[0]?.count ?? 0;
  }
  return counts;
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    printUsage();
    return;
  }

  assertQaDatabaseUrl(process.env.DATABASE_URL, process.env.ALLOW_NON_QA_RESET);
  if (apply && !confirmed) {
    throw new Error('Apply mode requires --confirm-qa-reset.');
  }

  const inImage = migrationsInImage();
  const prisma = new PrismaClient();
  try {
    const before = await readMigrationRows(prisma);
    const counts = await readRowCounts(prisma);
    const nonEmpty = Object.entries(counts).filter(([, count]) => count > 0);

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      migrationsInImage: inImage.length,
      migrationState: compareMigrationState(inImage, before),
      tables: Object.keys(counts).length,
      rowsToDestroy: nonEmpty.reduce((total, [, count]) => total + count, 0),
      nonEmptyTables: Object.fromEntries(nonEmpty),
    }, null, 2));

    if (!apply) {
      console.log('Dry run complete. Re-run with --apply --confirm-qa-reset to DESTROY every row above.');
      return;
    }
  } finally {
    // migrate reset drops the schema, so this client's connection must not be holding it.
    await prisma.$disconnect();
  }

  console.log('Resetting: prisma migrate reset --force --skip-seed ...');
  const reset = runPrisma(['migrate', 'reset', '--force', '--skip-seed', '--schema', SCHEMA_PATH]);
  if (reset.status !== 0) {
    throw new Error('prisma migrate reset failed. The database may be partially reset — re-run this script.');
  }

  const verifier = new PrismaClient();
  try {
    const after = await readMigrationRows(verifier);
    const state = compareMigrationState(inImage, after);
    if (state.missing.length > 0 || state.unexpected.length > 0 || state.unfinished.length > 0) {
      throw new Error(`The reset did not leave a clean history: ${JSON.stringify(state)}`);
    }
    console.log(`History is clean: ${inImage.length} migration(s) recorded and applied.`);
  } finally {
    await verifier.$disconnect();
  }

  if (!process.env.FIXTURE_JSON) {
    console.log('::warning::FIXTURE_JSON was not set, so QA has no users. Run the Create Test Users workflow.');
  } else {
    console.log('Restoring fixture users ...');
    const bootstrap = runNode([join('scripts', 'bootstrap-users.mjs')]);
    if (bootstrap.status !== 0) {
      throw new Error('bootstrap-users.mjs failed. QA is migrated but has no users.');
    }
  }

  console.log(
    'QA reset complete. Migrations gate the rollout, so the current main commit\'s deploy-qa was '
    + 'skipped — re-run that run\'s failed jobs to roll the release out.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
