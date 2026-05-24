/* global console, process */

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

export const MIGRATION_NAME = '20260506211309_substrate_redesign_phase4_foundation';
const PLAN_TIERS_TABLE = 'plan_tiers';
const SCHEMA_PATH = 'prisma/schema.prisma';
const ROW_COUNT_TABLES = [
  'contest_entry_participant_scores',
  'draft_pick_histories',
  'roster_picks',
  'sport_event_participant_source_data',
  'participant_season_records',
  'plan_tiers',
];

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const confirmed = args.has('--confirm-qa-substrate-repair');
const restorePlanTiers = !args.has('--skip-plan-tier-restore');

function printUsage() {
  console.log(`
Usage:
  node scripts/repair-substrate-foundation-migration.mjs [--apply --confirm-qa-substrate-repair]

Default mode is a read-only dry run.

This QA-only repair handles one exact state:
  - ${MIGRATION_NAME} is failed/unresolved
  - the failure log says relation "plan_tiers" already exists
  - plan_tiers exists, but the rest of the substrate migration did not apply

Apply mode:
  1. backs up plan_tiers rows to the task log
  2. drops only public.plan_tiers
  3. marks the failed migration rolled back with prisma migrate resolve
  4. reruns prisma migrate deploy
  5. restores backed-up plan_tiers rows if the migration leaves the table empty

Required apply flags:
  --apply
  --confirm-qa-substrate-repair

Optional:
  --skip-plan-tier-restore
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
    && process.env.ALLOW_NON_QA_SUBSTRATE_REPAIR !== 'true'
  ) {
    throw new Error(
      'Refusing to run: DATABASE_URL does not look like the QA RDS endpoint. '
        + 'Set ALLOW_NON_QA_SUBSTRATE_REPAIR=true only for an explicitly reviewed non-QA repair.',
    );
  }
}

async function readMigration(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count, logs
      FROM public."_prisma_migrations"
      WHERE migration_name = $1
      ORDER BY started_at DESC
    `,
    MIGRATION_NAME,
  );

  return rows;
}

async function readObjectChecks(prisma) {
  return prisma.$queryRawUnsafe(`
    SELECT *
    FROM (
      VALUES
        ('type:PrismaSportCategory', to_regtype('public."PrismaSportCategory"') IS NOT NULL),
        ('type:PrismaTournamentFormat', to_regtype('public."PrismaTournamentFormat"') IS NOT NULL),
        ('type:PrismaContestFormat', to_regtype('public."PrismaContestFormat"') IS NOT NULL),
        ('table:contest_sport_events', to_regclass('public.contest_sport_events') IS NOT NULL),
        ('table:contest_entry_picks', to_regclass('public.contest_entry_picks') IS NOT NULL),
        ('table:contest_entry_pick_golf_roster_contributions', to_regclass('public.contest_entry_pick_golf_roster_contributions') IS NOT NULL),
        ('table:sport_event_participant_golf_rounds', to_regclass('public.sport_event_participant_golf_rounds') IS NOT NULL),
        ('table:plan_tiers', to_regclass('public.plan_tiers') IS NOT NULL),
        ('old_table:roster_picks_absent', to_regclass('public.roster_picks') IS NULL),
        ('old_table:sport_event_participant_source_data_absent', to_regclass('public.sport_event_participant_source_data') IS NULL),
        ('old_table:participant_season_records_absent', to_regclass('public.participant_season_records') IS NULL),
        ('column:sports.category', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sports' AND column_name = 'category'
        )),
        ('column:sports.tournament_format', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sports' AND column_name = 'tournament_format'
        )),
        ('old_column:sports.stat_schema_absent', NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sports' AND column_name = 'stat_schema'
        )),
        ('column:contests.contest_format', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'contests' AND column_name = 'contest_format'
        )),
        ('old_column:contests.contest_type_absent', NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'contests' AND column_name = 'contest_type'
        )),
        ('column:sport_event_participants.world_ranking', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sport_event_participants' AND column_name = 'world_ranking'
        )),
        ('column:sport_event_participants.odds_to_win', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sport_event_participants' AND column_name = 'odds_to_win'
        )),
        ('column:sport_event_participants.seed_number', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sport_event_participants' AND column_name = 'seed_number'
        )),
        ('column:contest_entry_participant_scores.pick_id', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'contest_entry_participant_scores' AND column_name = 'pick_id'
        )),
        ('old_column:contest_entry_participant_scores.roster_pick_id_absent', NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'contest_entry_participant_scores' AND column_name = 'roster_pick_id'
        )),
        ('column:draft_pick_histories.pick_id', EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'draft_pick_histories' AND column_name = 'pick_id'
        )),
        ('old_column:draft_pick_histories.roster_pick_id_absent', NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'draft_pick_histories' AND column_name = 'roster_pick_id'
        )),
        ('old_column:participants.metadata_absent', NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'participants' AND column_name = 'metadata'
        ))
    ) AS checks(check_name, ok)
    ORDER BY check_name
  `);
}

async function readRowCounts(prisma) {
  const results = [];

  for (const tableName of ROW_COUNT_TABLES) {
    const [{ table_exists: tableExists }] = await prisma.$queryRawUnsafe(
      'SELECT to_regclass($1) IS NOT NULL AS table_exists',
      `public.${tableName}`,
    );

    if (!tableExists) {
      results.push({ table_name: tableName, row_count: null });
      continue;
    }

    const [{ row_count: rowCount }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS row_count FROM public.${quoteIdentifier(tableName)}`,
    );
    results.push({ table_name: tableName, row_count: Number(rowCount) });
  }

  return results.sort((left, right) => left.table_name.localeCompare(right.table_name));
}

async function readPlanTiers(prisma) {
  return prisma.$queryRawUnsafe(`
    SELECT
      id::text,
      name,
      slug,
      display_order,
      monthly_price_cents,
      annual_price_cents,
      trial_days,
      stripe_monthly_price_id,
      stripe_annual_price_id,
      entitlements,
      is_public,
      created_at,
      updated_at
    FROM public.plan_tiers
    ORDER BY display_order, slug
  `);
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

export function assertExpectedFailedState(migrations, objectChecks, rowCounts) {
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
  if (!logs.includes('relation "plan_tiers" already exists')) {
    throw new Error(
      `${MIGRATION_NAME} failed for a reason other than plan_tiers already existing. Manual triage required.`,
    );
  }

  const checkMap = new Map(objectChecks.map((row) => [row.check_name, Boolean(row.ok)]));

  const unexpectedAppliedChecks = [...checkMap.entries()]
    .filter(([name, ok]) => name !== 'table:plan_tiers' && !name.startsWith('old_') && ok);
  const unexpectedRemovedLegacyChecks = [...checkMap.entries()]
    .filter(([name, ok]) => name.startsWith('old_') && ok);

  if (!checkMap.get('table:plan_tiers')) {
    throw new Error('Expected public.plan_tiers to exist as the failed-migration artifact.');
  }
  if (unexpectedAppliedChecks.length > 0 || unexpectedRemovedLegacyChecks.length > 0) {
    throw new Error(
      `Substrate migration appears partially applied beyond plan_tiers: ${
        JSON.stringify({ unexpectedAppliedChecks, unexpectedRemovedLegacyChecks })
      }. Manual triage required.`,
    );
  }

  const countMap = new Map(rowCounts.map((row) => [row.table_name, Number(row.row_count)]));
  for (const tableName of ['contest_entry_participant_scores', 'draft_pick_histories']) {
    if ((countMap.get(tableName) ?? 0) !== 0) {
      throw new Error(
        `${tableName} is not empty. The migration adds NOT NULL pick_id without backfill; manual migration required.`,
      );
    }
  }
}

async function dropPlanTiers(prisma) {
  await prisma.$executeRawUnsafe(`DROP TABLE public.${quoteIdentifier(PLAN_TIERS_TABLE)}`);
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

async function restorePlanTierRows(prisma, planTiers) {
  const [{ row_count: rowCount }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS row_count FROM public.plan_tiers`,
  );

  if (Number(rowCount) > 0) {
    console.log(`plan_tiers already has ${rowCount} rows after migration; skipping restore.`);
    return;
  }

  for (const row of planTiers) {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO public.plan_tiers (
          id,
          name,
          slug,
          display_order,
          monthly_price_cents,
          annual_price_cents,
          trial_days,
          stripe_monthly_price_id,
          stripe_annual_price_id,
          entitlements,
          is_public,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::jsonb,
          $11,
          $12::timestamptz,
          $13::timestamptz
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          display_order = EXCLUDED.display_order,
          monthly_price_cents = EXCLUDED.monthly_price_cents,
          annual_price_cents = EXCLUDED.annual_price_cents,
          trial_days = EXCLUDED.trial_days,
          stripe_monthly_price_id = EXCLUDED.stripe_monthly_price_id,
          stripe_annual_price_id = EXCLUDED.stripe_annual_price_id,
          entitlements = EXCLUDED.entitlements,
          is_public = EXCLUDED.is_public,
          updated_at = EXCLUDED.updated_at
      `,
      row.id,
      row.name,
      row.slug,
      row.display_order,
      row.monthly_price_cents,
      row.annual_price_cents,
      row.trial_days,
      row.stripe_monthly_price_id,
      row.stripe_annual_price_id,
      JSON.stringify(row.entitlements ?? {}),
      row.is_public,
      row.created_at,
      row.updated_at,
    );
  }

  console.log(`Restored ${planTiers.length} plan_tiers rows.`);
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    printUsage();
    return;
  }

  assertQaDatabaseUrl();

  if (apply && !confirmed) {
    throw new Error('Apply mode requires --confirm-qa-substrate-repair.');
  }

  const prisma = new PrismaClient();
  try {
    const migrations = await readMigration(prisma);
    const objectChecks = await readObjectChecks(prisma);
    const rowCounts = await readRowCounts(prisma);

    assertExpectedFailedState(migrations, objectChecks, rowCounts);
    const planTiers = await readPlanTiers(prisma);

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      migration: migrations[0],
      rowCounts,
      planTierBackup: planTiers,
      objectChecks,
      restorePlanTiers,
    }, null, 2));

    if (!apply) {
      console.log('Dry run complete. Re-run with --apply --confirm-qa-substrate-repair to repair.');
      return;
    }

    console.log('Dropping failed-migration artifact public.plan_tiers...');
    await dropPlanTiers(prisma);

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
      throw new Error('prisma migrate deploy failed after dropping plan_tiers and resolving rollback.');
    }

    if (restorePlanTiers && planTiers.length > 0) {
      await restorePlanTierRows(prisma, planTiers);
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
    const postObjectChecks = await readObjectChecks(prisma);
    const failedPostChecks = postObjectChecks.filter((row) => !row.ok);
    if (failedPostChecks.length > 0) {
      throw new Error(
        `Post-repair substrate object checks failed: ${JSON.stringify(failedPostChecks)}`,
      );
    }

    console.log(JSON.stringify({
      repaired: true,
      migration: postMigrations[0],
      objectChecks: postObjectChecks,
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
