import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { compareMigrationState } from './migration-state.mjs';
import { migrationsInImage } from './reset-qa-database.mjs';

// QA's migrate task: `prisma migrate deploy`, after one check Prisma does not make.
//
// When the database records applied migrations this image does not carry, the history was
// squashed (#1429) or rewritten, and `migrate deploy` would try to build the baseline over tables
// that already exist and fail with a raw SQL error. Nothing can repair that in place on QA; the
// Reset QA database workflow wipes it and replays this image's migrations. So the task stops
// before deploying and says so. The per-migration repairs this file used to carry named
// migrations the squash deleted, and went with them.

/**
 * Why this image cannot migrate the database, or null when it can. `recorded` is the database's
 * `_prisma_migrations` rows; an empty list is a new database, which deploys normally.
 */
export function historyMismatch(inImage, recorded) {
  const { unexpected } = compareMigrationState(inImage, recorded);
  if (unexpected.length === 0) return null;
  const shown = unexpected.slice(0, 5).join(', ');
  const more = unexpected.length > 5 ? ` and ${unexpected.length - 5} more` : '';
  return `The database records ${unexpected.length} applied migration(s) this image does not carry `
    + `(${shown}${more}). The migration history was squashed or rewritten, so it cannot be `
    + 'migrated in place: run the "Reset QA database" workflow, then re-run this deploy.';
}

/**
 * Whether a read failed only because `_prisma_migrations` does not exist, which means the
 * database has never been migrated. Prisma reports Postgres's undefined_table (42P01) as P2010.
 * Anything else (bad URL, auth, network, permissions) is a real failure and must not read as an
 * empty history.
 */
export function isMissingMigrationsTable(error) {
  return error?.code === 'P2010' && error?.meta?.code === '42P01';
}

async function readMigrationRows(prisma) {
  try {
    return await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at, rolled_back_at
      FROM public."_prisma_migrations"
    `);
  } catch (error) {
    if (isMissingMigrationsTable(error)) return [];
    throw error;
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const mismatch = historyMismatch(migrationsInImage(), await readMigrationRows(prisma));
    if (mismatch) throw new Error(mismatch);
  } finally {
    await prisma.$disconnect();
  }

  console.log('Running prisma migrate deploy...');
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error('prisma migrate deploy failed. If QA is stuck, run the "Reset QA database" workflow.');
  }
  console.log('Prisma migrations completed successfully.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
