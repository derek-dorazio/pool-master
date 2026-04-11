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
      FROM "_prisma_migrations"
      WHERE migration_name = $1
        AND finished_at IS NULL
        AND rolled_back_at IS NULL
      LIMIT 1
    `,
    migrationName,
  );

  return Array.isArray(rows) && rows.length > 0;
}

async function repairLeagueCodeMigration(prisma) {
  console.log(`Attempting one-time repair for migration ${LEAGUE_CODE_MIGRATION}...`);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "leagues"
    ADD COLUMN IF NOT EXISTS "league_code" VARCHAR(16);
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "leagues"
    SET "league_code" = LEFT(
      CONCAT(
        COALESCE(NULLIF(UPPER(REGEXP_REPLACE("name", '[^A-Za-z0-9]+', '', 'g')), ''), 'LEAGUE'),
        RIGHT(REPLACE("id"::text, '-', ''), 4)
      ),
      16
    )
    WHERE "league_code" IS NULL;
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

  if (result.status === 0) {
    console.log('Prisma migrations completed successfully.');
    return;
  }

  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const prisma = new PrismaClient();

  try {
    const unresolvedLeagueCodeMigration = await hasUnresolvedFailedMigration(
      prisma,
      LEAGUE_CODE_MIGRATION,
    );

    if (!unresolvedLeagueCodeMigration) {
      throw new Error(
        `Migration deploy failed and no resolvable ${LEAGUE_CODE_MIGRATION} failure was found.\n${combinedOutput}`,
      );
    }

    await repairLeagueCodeMigration(prisma);

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

    console.log('Retrying prisma migrate deploy after repair...');
    result = runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma']);

    if (result.status !== 0) {
      throw new Error('Prisma migrate deploy still failed after repairing league_code migration.');
    }

    console.log('Prisma migrations completed successfully after repair.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
