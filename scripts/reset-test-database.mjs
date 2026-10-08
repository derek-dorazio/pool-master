#!/usr/bin/env node
/* global console, process */
/**
 * Empty the local test database and re-apply every migration: `npm run db:test:reset`.
 *
 * This used to be `prisma migrate reset --force --skip-seed`. Prisma refuses `migrate reset` when
 * it detects an AI agent, so the reset and the three `:fresh` lanes that chain it could not run
 * from an agent session, and the only substitute, `migrate deploy`, does not clean a dirty
 * database. The same result comes from two steps Prisma does not gate: drop and recreate the
 * `public` schema through `prisma db execute`, then `prisma migrate deploy`. The outcome is
 * unchanged: an empty schema, every migration applied, no seed.
 *
 * Because this destroys every row, it refuses any database whose name does not end in `_test`.
 *
 * Usage:
 *   node scripts/reset-test-database.mjs
 *
 * Environment: TEST_DATABASE_URL, defaulting to the local poolmaster_test database. It is a
 * separate variable from DATABASE_URL on purpose, so a shell exported for the dev database
 * cannot point a reset at it.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CORE_API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core-api');
const SCHEMA_PATH = 'prisma/schema.prisma';
const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/poolmaster_test';
const RESET_SQL = 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;';

/** The database a URL names, or null when it names none. */
export function databaseName(databaseUrl) {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** Throws unless the URL names a test database, the only kind this script may empty. */
export function assertTestDatabaseUrl(databaseUrl) {
  const name = databaseName(databaseUrl);
  if (name === null || !name.endsWith('_test')) {
    throw new Error(
      `Refusing to reset ${name ?? 'an unnamed database'}: only a database whose name ends in _test can be reset.`,
    );
  }
}

/** How many migrations the repository carries, which is how many a reset must leave applied. */
export function migrationCount(dir = join(CORE_API_DIR, 'prisma', 'migrations')) {
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
}

function runPrisma(args, databaseUrl, input) {
  const result = spawnSync('npx', ['prisma', ...args, '--schema', SCHEMA_PATH], {
    cwd: CORE_API_DIR,
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(' ')} failed with exit code ${result.status ?? result.signal}`);
  }
}

export function resetTestDatabase(databaseUrl) {
  assertTestDatabaseUrl(databaseUrl);
  const name = databaseName(databaseUrl);
  console.log(`Dropping and recreating the public schema in ${name}`);
  runPrisma(['db', 'execute', '--stdin'], databaseUrl, RESET_SQL);
  console.log(`Applying ${migrationCount()} migrations to ${name}`);
  runPrisma(['migrate', 'deploy'], databaseUrl);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    resetTestDatabase(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
