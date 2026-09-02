/* global console, process */

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

export const MIGRATION_NAME = '20260902110000_add_sport_league_season_roster';
const SCHEMA_PATH = 'prisma/schema.prisma';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmed = args.has('--confirm-qa-season-repair');

function printUsage() {
  console.log(`
Usage:
  node scripts/repair-sport-league-season-migration.mjs [--apply --confirm-qa-season-repair]

Default mode is a read-only dry run.

This QA-only repair handles one exact state:
  - ${MIGRATION_NAME} is failed/unresolved
  - the failure log says column "sport_league_id" of relation "seasons"
    contains null values (Postgres error 23502, raised by the migration's
    own ALTER COLUMN ... SET NOT NULL step)
  - Postgres rolled the whole migration transaction back on that failure,
    so "seasons" is still in its pre-migration shape (has sport_id, no
    sport_league_id/is_active) and sport_leagues/participant_league_affiliations
    do not exist yet

The Season table was dormant (this migration's own header says "zero
existing rows/callers — confirmed by grep"). That was true of every caller
in the codebase but not of QA's actual database, which has leftover rows
from earlier, unrelated schema experimentation. Per the user's explicit
decision, this repair treats those rows as disposable rather than backfilling
a real SportLeague for them.

Apply mode:
  1. backs up every "seasons" row to the task log
  2. verifies nothing else references "seasons" via a foreign key (aborts
     if anything unexpected does — this repair is only for genuinely
     orphaned, uncalled Season rows)
  3. deletes all rows from public.seasons
  4. marks the failed migration rolled back with prisma migrate resolve
  5. reruns prisma migrate deploy

Required apply flags:
  --apply
  --confirm-qa-season-repair
`);
}

function runPrisma(argsToRun) {
  const result = spawnSync('npx', ['prisma', ...argsToRun], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

function assertQaDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  if (
    !databaseUrl.includes('poolmaster-qa-postgres')
    && process.env.ALLOW_NON_QA_SEASON_REPAIR !== 'true'
  ) {
    throw new Error(
      'Refusing to run: DATABASE_URL does not look like the QA RDS endpoint. '
        + 'Set ALLOW_NON_QA_SEASON_REPAIR=true only for an explicitly reviewed non-QA repair.',
    );
  }
}

async function readMigration(prisma) {
  return prisma.$queryRawUnsafe(
    `
      SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
      FROM public."_prisma_migrations"
      WHERE migration_name = $1
      ORDER BY started_at DESC
    `,
    MIGRATION_NAME,
  );
}

async function readObjectChecks(prisma) {
  return prisma.$queryRawUnsafe(`
    SELECT *
    FROM (
      VALUES
        ('table:sport_leagues_absent', to_regclass('public.sport_leagues') IS NULL),
        ('table:participant_league_affiliations_absent', to_regclass('public.participant_league_affiliations') IS NULL),
        ('column:seasons.sport_id_present', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'seasons' AND column_name = 'sport_id'
        )),
        ('column:seasons.sport_league_id_absent', NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'seasons' AND column_name = 'sport_league_id'
        )),
        ('column:sport_events.season_id_absent', NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'season_id'
        ))
    ) AS checks(check_name, ok)
    ORDER BY check_name
  `);
}

async function readSeasonRows(prisma) {
  return prisma.$queryRawUnsafe(`
    SELECT
      id::text,
      sport_id::text,
      name,
      year,
      start_date,
      end_date,
      created_at,
      updated_at
    FROM public.seasons
    ORDER BY year, name
  `);
}

async function readForeignKeysReferencingSeasons(prisma) {
  return prisma.$queryRawUnsafe(`
    SELECT
      tc.table_name AS referencing_table,
      kcu.column_name AS referencing_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = 'seasons'
  `);
}

export function assertExpectedFailedState(migrations, objectChecks, foreignKeys) {
  if (migrations.length !== 1) {
    throw new Error(
      `Expected exactly one ${MIGRATION_NAME} row, found ${migrations.length}. Manual triage required.`,
    );
  }

  const migration = migrations[0];
  if (migration.finished_at !== null || migration.rolled_back_at !== null) {
    throw new Error(
      `${MIGRATION_NAME} is not in the unresolved failed state. No repair needed by this script.`,
    );
  }

  const logs = String(migration.logs ?? '');
  if (!logs.includes('sport_league_id') || !logs.includes('contains null values')) {
    throw new Error(
      `${MIGRATION_NAME} failed for a reason other than seasons.sport_league_id containing null values. Manual triage required.`,
    );
  }

  const checkMap = new Map(objectChecks.map((row) => [row.check_name, Boolean(row.ok)]));
  const failedChecks = [...checkMap.entries()].filter(([, ok]) => !ok);
  if (failedChecks.length > 0) {
    throw new Error(
      `Migration transaction did not fully roll back as expected: ${
        JSON.stringify(failedChecks.map(([name]) => name))
      }. Manual triage required.`,
    );
  }

  if (foreignKeys.length > 0) {
    throw new Error(
      `Refusing to delete seasons rows: found live foreign key reference(s) into public.seasons: ${
        JSON.stringify(foreignKeys)
      }. These rows are not safely disposable — manual triage required.`,
    );
  }
}

async function deleteAllSeasons(prisma) {
  await prisma.$executeRawUnsafe('DELETE FROM public.seasons');
}

async function readUnresolvedFailedMigrations(prisma) {
  return prisma.$queryRawUnsafe(`
    SELECT migration_name
    FROM public."_prisma_migrations"
    WHERE finished_at IS NULL
      AND rolled_back_at IS NULL
    ORDER BY started_at ASC
  `);
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    printUsage();
    return;
  }

  assertQaDatabaseUrl();

  if (apply && !confirmed) {
    throw new Error('Apply mode requires --confirm-qa-season-repair.');
  }

  const prisma = new PrismaClient();
  try {
    const migrations = await readMigration(prisma);
    const objectChecks = await readObjectChecks(prisma);
    const foreignKeys = await readForeignKeysReferencingSeasons(prisma);

    assertExpectedFailedState(migrations, objectChecks, foreignKeys);
    const seasonRows = await readSeasonRows(prisma);

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      migration: migrations[0],
      objectChecks,
      foreignKeys,
      seasonRowBackup: seasonRows,
      seasonRowCount: seasonRows.length,
    }, null, 2));

    if (!apply) {
      console.log('Dry run complete. Re-run with --apply --confirm-qa-season-repair to repair.');
      return;
    }

    console.log(`Deleting ${seasonRows.length} disposable row(s) from public.seasons...`);
    await deleteAllSeasons(prisma);

    console.log(`Resolving ${MIGRATION_NAME} as rolled back...`);
    const resolveResult = runPrisma([
      'migrate',
      'resolve',
      '--rolled-back',
      MIGRATION_NAME,
      '--schema',
      SCHEMA_PATH,
    ]);
    if (resolveResult.status !== 0) {
      throw new Error(`prisma migrate resolve --rolled-back failed for ${MIGRATION_NAME}.`);
    }

    console.log('Running prisma migrate deploy...');
    const deployResult = runPrisma(['migrate', 'deploy', '--schema', SCHEMA_PATH]);
    if (deployResult.status !== 0) {
      throw new Error('prisma migrate deploy failed after deleting seasons rows and resolving rollback.');
    }

    const unresolved = await readUnresolvedFailedMigrations(prisma);
    if (unresolved.length > 0) {
      throw new Error(
        `Unresolved failed migrations remain after repair: ${
          unresolved.map((row) => row.migration_name).join(', ')
        }`,
      );
    }

    const postMigrations = await readMigration(prisma);
    console.log(JSON.stringify({
      repaired: true,
      migration: postMigrations[0],
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
