import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const LEAGUE_CODE_MIGRATION = '20260411173000_add_league_code';

function runPrisma(args) {
  const result = spawnSync('npx', ['prisma', ...args], {
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

async function hasUnresolvedFailedMigration(prisma, migrationName) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT migration_name
      FROM public."_prisma_migrations"
      WHERE migration_name = $1
        AND finished_at IS NULL
        AND rolled_back_at IS NULL
      LIMIT 1
    `,
    migrationName,
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function isMigrationMarkedApplied(prisma, migrationName) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT migration_name
      FROM public."_prisma_migrations"
      WHERE migration_name = $1
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
      LIMIT 1
    `,
    migrationName,
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function listUnresolvedFailedMigrations(prisma) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT migration_name
    FROM public."_prisma_migrations"
    WHERE finished_at IS NULL
      AND rolled_back_at IS NULL
    ORDER BY started_at ASC
  `);

  return Array.isArray(rows) ? rows.map((row) => row.migration_name) : [];
}

async function readLeagueCodeMigrationHealth(prisma) {
  const [state] = await prisma.$queryRawUnsafe(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leagues'
          AND column_name = 'league_code'
      ) AS has_column,
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'leagues'
          AND indexname = 'leagues_league_code_key'
      ) AS has_unique_index,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leagues'
          AND column_name = 'league_code'
          AND is_nullable = 'YES'
      ) AS is_nullable,
      EXISTS (
        SELECT 1
        FROM "leagues"
        WHERE "league_code" IS NULL
      ) AS has_null_codes,
      EXISTS (
        SELECT 1
        FROM (
          SELECT "league_code"
          FROM "leagues"
          GROUP BY "league_code"
          HAVING COUNT(*) > 1
        ) duplicates
      ) AS has_duplicate_codes
  `);

  return {
    hasColumn: Boolean(state?.has_column),
    hasUniqueIndex: Boolean(state?.has_unique_index),
    isNullable: Boolean(state?.is_nullable),
    hasNullCodes: Boolean(state?.has_null_codes),
    hasDuplicateCodes: Boolean(state?.has_duplicate_codes),
  };
}

async function assertNoUnresolvedFailedMigrations(prisma) {
  const unresolved = await listUnresolvedFailedMigrations(prisma);
  if (unresolved.length > 0) {
    throw new Error(`Prisma still reports unresolved failed migrations: ${unresolved.join(', ')}`);
  }
}

async function assertLeagueCodeMigrationHealthy(prisma) {
  const health = await readLeagueCodeMigrationHealth(prisma);
  if (
    !health.hasColumn
    || !health.hasUniqueIndex
    || health.isNullable
    || health.hasNullCodes
    || health.hasDuplicateCodes
  ) {
    throw new Error(
      `league_code migration health check failed: ${JSON.stringify(health)}`,
    );
  }
}

async function shouldRepairLeagueCodeMigration(prisma) {
  if (await hasUnresolvedFailedMigration(prisma, LEAGUE_CODE_MIGRATION)) {
    return true;
  }

  if (!(await isMigrationMarkedApplied(prisma, LEAGUE_CODE_MIGRATION))) {
    return false;
  }

  const health = await readLeagueCodeMigrationHealth(prisma);
  return (
    !health.hasColumn
    || !health.hasUniqueIndex
    || health.isNullable
    || health.hasNullCodes
    || health.hasDuplicateCodes
  );
}

async function repairLeagueCodeMigration(prisma) {
  console.log(`Attempting one-time repair for migration ${LEAGUE_CODE_MIGRATION}...`);

  await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS "leagues_league_code_key";
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "leagues"
    ADD COLUMN IF NOT EXISTS "league_code" VARCHAR(16);
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "leagues"
    SET "league_code" = CONCAT(
      LEFT(
        COALESCE(NULLIF(UPPER(REGEXP_REPLACE("name", '[^A-Za-z0-9]+', '', 'g')), ''), 'LEAGUE'),
        8
      ),
      RIGHT(REPLACE("id"::text, '-', ''), 8)
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "leagues"
    ALTER COLUMN "league_code" SET NOT NULL;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "leagues_league_code_key"
    ON "leagues"("league_code");
  `);
}

async function main() {
  console.log('Running prisma migrate deploy...');
  let result = runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);

  const prisma = new PrismaClient();

  if (result.status === 0) {
    await assertNoUnresolvedFailedMigrations(prisma);
    if (await isMigrationMarkedApplied(prisma, LEAGUE_CODE_MIGRATION)) {
      await assertLeagueCodeMigrationHealthy(prisma);
    }
    console.log('Prisma migrations completed successfully.');
    await prisma.$disconnect();
    return;
  }

  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  try {
    const shouldRepair = await shouldRepairLeagueCodeMigration(prisma);

    if (!shouldRepair) {
      throw new Error(
        `Migration deploy failed and no resolvable ${LEAGUE_CODE_MIGRATION} failure was found.\n${combinedOutput}`,
      );
    }

    await repairLeagueCodeMigration(prisma);
    await assertLeagueCodeMigrationHealthy(prisma);

    if (await hasUnresolvedFailedMigration(prisma, LEAGUE_CODE_MIGRATION)) {
      console.log(`Resolving ${LEAGUE_CODE_MIGRATION} as applied...`);
      result = runPrisma([
        'migrate',
        'resolve',
        '--applied',
        LEAGUE_CODE_MIGRATION,
        '--schema',
        'prisma/schema.prisma',
      ]);

      if (result.status !== 0) {
        throw new Error(`Failed to resolve ${LEAGUE_CODE_MIGRATION} as applied.`);
      }
    }

    console.log('Retrying prisma migrate deploy after repair...');
    result = runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);

    if (result.status !== 0) {
      throw new Error('Prisma migrate deploy still failed after repairing league_code migration.');
    }

    await assertNoUnresolvedFailedMigrations(prisma);
    await assertLeagueCodeMigrationHealthy(prisma);
    console.log('Prisma migrations completed successfully after repair.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
