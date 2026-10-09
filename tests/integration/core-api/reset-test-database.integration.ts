/**
 * #356 — `npm run db:test:reset` empties a test database and re-applies every migration, without
 * `prisma migrate reset`, which Prisma refuses to run for an AI agent.
 *
 * The reset runs against a throwaway database of its own, created and dropped here, so the shared
 * poolmaster_test the rest of the suite uses is never touched. TEST_DATABASE_URL is how the script
 * is pointed at it.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const REPO_ROOT = join(__dirname, '../../..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages/core-api/prisma/migrations');

function databaseUrlFor(name: string): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${name}`;
  return url.toString();
}

function runReset(testDatabaseUrl: string): void {
  execFileSync('npm', ['run', '--silent', 'db:test:reset'], {
    cwd: REPO_ROOT,
    env: { ...process.env, TEST_DATABASE_URL: testDatabaseUrl },
    stdio: 'pipe',
  });
}

describe('db:test:reset', () => {
  const scratchName = `poolmaster_reset_${randomUUID().replace(/-/g, '').slice(0, 12)}_test`;
  const scratchUrl = databaseUrlFor(scratchName);
  const admin = new PrismaClient();
  let scratch: PrismaClient;

  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${scratchName}"`);
    scratch = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
  });

  afterAll(async () => {
    await scratch.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await admin.$disconnect();
  });

  it('leaves a dirty test database with no stray tables and every migration applied', async () => {
    await scratch.$executeRawUnsafe('CREATE TABLE "stray_rows" ("id" integer PRIMARY KEY)');
    await scratch.$executeRawUnsafe('INSERT INTO "stray_rows" ("id") VALUES (1)');
    await scratch.$disconnect();

    runReset(scratchUrl);

    const stray = await scratch.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'stray_rows'`,
    );
    expect(Number(stray[0].count)).toBe(0);

    const applied = await scratch.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const inRepo = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
    expect(Number(applied[0].count)).toBe(inRepo);
  }, 120_000);
});
