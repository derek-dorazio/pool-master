/* global console, process */

/**
 * plans/147 slice 2 (#315) — the scripted repair for the one way the Season collapse is
 * expected to refuse on QA.
 *
 * The collapse migration checks four kinds of bad data before its first write. Three of
 * them need a decision about which tour or which edition is real, and plans/147 says that
 * decision belongs to the owner, not to a script. The fourth does not: an event with no
 * season was created by provider sync, which until this slice was the one write path that
 * could make one (`IngestionPersistence.persistEvents` upserted on
 * (providerId, externalId) with no season and no series). Nobody chose those rows, nothing
 * can give them a tour, and this slice removes the path that makes them.
 *
 * So this repair deletes exactly those rows and only when they are genuinely disposable —
 * no contest, and nothing else referencing them that this script does not know how to
 * clear. Anything else, including the other three checks, it refuses and leaves for triage.
 *
 * Without it, a refusal leaves `_prisma_migrations` holding a failed row, and Prisma then
 * answers P3009 — "migrate found failed migrations in the target database, new migrations
 * will not be applied" — to every later deploy. Fixing the rows is not enough on its own;
 * the failed row has to be resolved too. That is defect #191's shape, and this script is
 * registered in `run-migrations.mjs`'s SCRIPTED_REPAIRS so the migrate task runs it rather
 * than exiting 1 on every push.
 */

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

export const MIGRATION_NAME = '20261003180000_collapse_season_into_event_year';
const SCHEMA_PATH = 'prisma/schema.prisma';

/**
 * The 0a check's message. The migration raises a different message for each of its four
 * checks, so this is what distinguishes the one failure this script may repair from the
 * three it must not.
 */
const SEASONLESS_FAILURE_FRAGMENT = 'sport_events have no season';

/**
 * Every child of sport_events this script clears, extension rows before their core rows —
 * the order `PrismaSportEventRepository.delete` uses, because each one holds a RESTRICT
 * foreign key and deleting only the event row fails for any event with a round.
 *
 * Each step's `sql` takes the candidate event ids as $1; `table` is what the log reports
 * the row count against.
 */
const CASCADE_STEPS = [
  {
    table: 'sport_event_participant_golf_rounds',
    sql: `DELETE FROM public.sport_event_participant_golf_rounds
           WHERE participant_round_id IN (
             SELECT r.id FROM public.sport_event_participant_rounds r
             JOIN public.sport_event_participants p ON p.id = r.sport_event_participant_id
            WHERE p.sport_event_id = ANY($1::uuid[]))`,
  },
  {
    table: 'sport_event_participant_rounds',
    sql: `DELETE FROM public.sport_event_participant_rounds
           WHERE sport_event_participant_id IN (
             SELECT id FROM public.sport_event_participants WHERE sport_event_id = ANY($1::uuid[]))`,
  },
  {
    table: 'sport_event_participant_golf_standings',
    sql: `DELETE FROM public.sport_event_participant_golf_standings
           WHERE standing_id IN (
             SELECT s.id FROM public.sport_event_participant_standings s
             JOIN public.sport_event_participants p ON p.id = s.sport_event_participant_id
            WHERE p.sport_event_id = ANY($1::uuid[]))`,
  },
  {
    table: 'sport_event_participant_standings',
    sql: `DELETE FROM public.sport_event_participant_standings
           WHERE sport_event_participant_id IN (
             SELECT id FROM public.sport_event_participants WHERE sport_event_id = ANY($1::uuid[]))`,
  },
  {
    table: 'sport_event_participant_valuations',
    sql: `DELETE FROM public.sport_event_participant_valuations
           WHERE sport_event_participant_id IN (
             SELECT id FROM public.sport_event_participants WHERE sport_event_id = ANY($1::uuid[]))`,
  },
  {
    table: 'sport_event_participants',
    sql: 'DELETE FROM public.sport_event_participants WHERE sport_event_id = ANY($1::uuid[])',
  },
  {
    table: 'sport_event_rounds',
    sql: 'DELETE FROM public.sport_event_rounds WHERE sport_event_id = ANY($1::uuid[])',
  },
  {
    table: 'sport_event_tiers',
    sql: 'DELETE FROM public.sport_event_tiers WHERE sport_event_id = ANY($1::uuid[])',
  },
  {
    table: 'sport_events',
    sql: 'DELETE FROM public.sport_events WHERE id = ANY($1::uuid[])',
  },
];

/** The tables CASCADE_STEPS clears, so a reference from anywhere else is a surprise. */
export const CLEARED_TABLES = new Set(CASCADE_STEPS.map((step) => step.table));

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmed = args.has('--confirm-qa-season-collapse-repair');

function printUsage() {
  console.log(`
Usage:
  node scripts/repair-season-collapse-migration.mjs [--apply --confirm-qa-season-collapse-repair]

Default mode is a read-only dry run.

This QA-only repair handles one exact state:
  - ${MIGRATION_NAME} is failed/unresolved
  - its failure log is the "${SEASONLESS_FAILURE_FRAGMENT}" check (plans/147 step 0a),
    not one of the other three, which need an owner's decision about which tour
    or which edition is real
  - the migration's checks run before its first write, so the database is still
    in its pre-migration shape: "seasons" present, sport_events.season_id
    present, sport_events.event_year absent, and slice 1's "event_series" present

Season-less events can only have come from provider sync, which created them with
no season and no series; nobody chose them, nothing records which tour they belong
to, and this slice removes the path that makes them.

Apply mode:
  1. backs up every season-less sport_events row to the task log
  2. refuses if any of them has a contest, or if anything outside this script's
     own cascade references them (those rows are not disposable)
  3. deletes them with their rounds, tiers and field, in one transaction
  4. marks the failed migration rolled back with prisma migrate resolve
  5. reruns prisma migrate deploy

Required apply flags:
  --apply
  --confirm-qa-season-collapse-repair
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
    && process.env.ALLOW_NON_QA_SEASON_COLLAPSE_REPAIR !== 'true'
  ) {
    throw new Error(
      'Refusing to run: DATABASE_URL does not look like the QA RDS endpoint. '
        + 'Set ALLOW_NON_QA_SEASON_COLLAPSE_REPAIR=true only for an explicitly reviewed non-QA repair.',
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
        ('table:seasons_present', to_regclass('public.seasons') IS NOT NULL),
        ('table:event_series_present', to_regclass('public.event_series') IS NOT NULL),
        ('column:sport_events.season_id_present', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'season_id'
        )),
        ('column:sport_events.event_year_absent', NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sport_events' AND column_name = 'event_year'
        ))
    ) AS checks(check_name, ok)
    ORDER BY check_name
  `);
}

/** Every event the 0a check refused: no season, so no path to a tour and no year. */
async function readSeasonlessEvents(prisma) {
  return prisma.$queryRawUnsafe(`
    SELECT
      id::text,
      external_id,
      provider_id,
      sport,
      name,
      start_date,
      end_date,
      status::text,
      sync_scope::text,
      event_series_id::text,
      created_at
    FROM public.sport_events
    WHERE season_id IS NULL
    ORDER BY start_date, name
  `);
}

/**
 * Anything referencing the candidates that CASCADE_STEPS does not clear — a contest first
 * of all, which is also why `deleteEvent` refuses an event that has one. Read from
 * information_schema rather than a hardcoded list, so a child added later shows up here
 * as a refusal instead of a foreign-key error mid-repair.
 */
async function readBlockingReferences(prisma, eventIds) {
  const referencing = await prisma.$queryRawUnsafe(`
    SELECT tc.table_name AS referencing_table, kcu.column_name AS referencing_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = 'sport_events'
      AND ccu.column_name = 'id'
    ORDER BY 1, 2
  `);

  const blocking = [];
  for (const row of referencing) {
    if (CLEARED_TABLES.has(row.referencing_table)) {
      continue;
    }
    const counted = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM public."${row.referencing_table}"
        WHERE "${row.referencing_column}" = ANY($1::uuid[])`,
      eventIds,
    );
    const count = counted[0]?.count ?? 0;
    if (count > 0) {
      blocking.push({ ...row, count });
    }
  }
  return blocking;
}

export function assertExpectedFailedState(migrations, objectChecks, seasonlessEvents, blockingReferences) {
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
  if (!logs.includes(SEASONLESS_FAILURE_FRAGMENT)) {
    throw new Error(
      `${MIGRATION_NAME} failed on a check other than "${SEASONLESS_FAILURE_FRAGMENT}". `
        + 'The other three checks — a duplicate edition, a series and season on different tours, '
        + 'a current season of another tour — each need a decision about which row is real '
        + '(plans/147). Manual triage required.',
    );
  }

  const checkMap = new Map(objectChecks.map((row) => [row.check_name, Boolean(row.ok)]));
  const failedChecks = [...checkMap.entries()].filter(([, ok]) => !ok);
  if (failedChecks.length > 0) {
    throw new Error(
      `Database is not in the pre-migration shape the checks leave behind: ${
        JSON.stringify(failedChecks.map(([name]) => name))
      }. Manual triage required.`,
    );
  }

  if (seasonlessEvents.length === 0) {
    throw new Error(
      `${MIGRATION_NAME} failed on the season-less check but no season-less sport_events remain. `
        + 'Something changed the rows since the failure — manual triage required.',
    );
  }

  if (blockingReferences.length > 0) {
    throw new Error(
      `Refusing to delete season-less sport_events: ${JSON.stringify(blockingReferences)} `
        + 'reference them. A contest on one of these events means it is real data, not sync residue. '
        + 'Manual triage required.',
    );
  }
}

async function deleteSeasonlessEvents(prisma, eventIds) {
  const deleted = [];
  await prisma.$transaction(async (tx) => {
    for (const step of CASCADE_STEPS) {
      const rows = await tx.$executeRawUnsafe(step.sql, eventIds);
      deleted.push({ table: step.table, rows });
    }
  });
  return deleted;
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
    throw new Error('Apply mode requires --confirm-qa-season-collapse-repair.');
  }

  const prisma = new PrismaClient();
  try {
    const migrations = await readMigration(prisma);
    const objectChecks = await readObjectChecks(prisma);
    const seasonlessEvents = await readSeasonlessEvents(prisma);
    const eventIds = seasonlessEvents.map((row) => row.id);
    const blockingReferences = eventIds.length > 0
      ? await readBlockingReferences(prisma, eventIds)
      : [];

    assertExpectedFailedState(migrations, objectChecks, seasonlessEvents, blockingReferences);

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      migration: migrations[0],
      objectChecks,
      seasonlessEventBackup: seasonlessEvents,
      seasonlessEventCount: seasonlessEvents.length,
    }, null, 2));

    if (!apply) {
      console.log('Dry run complete. Re-run with --apply --confirm-qa-season-collapse-repair to repair.');
      return;
    }

    console.log(`Deleting ${seasonlessEvents.length} season-less sport_event(s) with their rounds, tiers and field...`);
    const deleted = await deleteSeasonlessEvents(prisma, eventIds);
    console.log(JSON.stringify({ deleted }, null, 2));

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
      throw new Error('prisma migrate deploy failed after deleting the season-less events and resolving rollback.');
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
