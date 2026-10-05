#!/usr/bin/env node
/**
 * SessionStart hook — bring a cloud container up to the point where the repo's
 * own quality gates can run.
 *
 * A fresh Claude Code cloud container is missing five things, and each one
 * shows up as a symptom that reads like broken code rather than missing setup:
 *
 *   1. No node_modules. `npx turbo typecheck` reports ~200
 *      `TS2307: Cannot find module 'zod'` errors across packages/shared.
 *   2. No generated Prisma client. core-api typecheck reports
 *      `TS2305: Module '@prisma/client' has no exported member 'League'`, every
 *      Prisma-derived type collapses to `any`, and lint then emits on the order
 *      of 2000 false errors. This is the dangerous one: an agent that meets the
 *      lint face first can spend a whole session "fixing" nothing.
 *   3. Postgres is installed but the Debian cluster is down (`pg_isready` ->
 *      no response), and the `postgres` role has no password, so the documented
 *      URL postgresql://postgres:postgres@localhost:5432/... cannot connect.
 *   4. No `poolmaster_test` database, which every DB-backed gate targets.
 *   5. That database has no schema.
 *
 * Each step checks first and skips when already done, so a warm container costs
 * a few file reads plus three short psql/pg_isready calls -- well under a second.
 * The client check compares the schema Prisma copied into the generated client
 * against the checked-in schema, so a branch that changes schema.prisma also
 * regenerates. The migration check compares applied rows in _prisma_migrations
 * against migration directories, so a branch that adds a migration also deploys.
 *
 * Migrations go through `prisma migrate deploy`, NOT `npm run db:test:reset`.
 * `migrate reset` is refused by Prisma when it detects an AI agent unless
 * PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION carries the user's literal
 * consent, and `reset` is the wrong verb for a database that was just created
 * anyway. `deploy` is non-destructive and needs no consent.
 *
 * Not built here: @poolmaster/shared. typecheck's turbo task already depends on
 * ^build, and the gates were verified passing from a cold container without a
 * separate shared build, so adding one would only cost time on every cold start.
 *
 * CLOUD ONLY. Everything below assumes the cloud image -- root, a Debian
 * pg_ctlcluster, peer auth for the postgres OS user. On a developer machine the
 * database comes from docker compose (`npm run dev:infra`) and installs are the
 * developer's business, so outside CLAUDE_CODE_REMOTE=true the hook exits 0
 * without doing or printing anything.
 *
 * GATE OR WARNING -- it cannot gate, so it is loud instead. A SessionStart hook
 * has no way to stop a session from starting, and a non-zero exit would only
 * route the message to the user's terminal while hiding it from the agent --
 * the reader who most needs it. So the hook always exits 0 and grades what it
 * reports:
 *
 *   - FAILED for npm ci or prisma generate. Without them typecheck and lint
 *     output is noise, and the message says so in as many words: do not act on
 *     those errors, fix the install first.
 *   - WARNING for Postgres and the test database. Plenty of sessions never
 *     touch the database, and typecheck, lint and both unit suites run fine
 *     without it; only integration, functional and merged-coverage need it.
 *
 * IT DOES NOT SWALLOW ERRORS. Every step reports its outcome -- done, already
 * ready, or failed with the command's own error output. A hook that reported
 * success while `prisma generate` failed would recreate the exact false-error
 * trap it exists to prevent.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const SCHEMA = join(ROOT, 'packages/core-api/prisma/schema.prisma');
const MIGRATIONS_DIR = join(ROOT, 'packages/core-api/prisma/migrations');
const PRISMA_BIN = join(ROOT, 'node_modules/.bin/prisma');
const TEST_DB = 'poolmaster_test';
const TEST_DB_URL = `postgresql://postgres:postgres@localhost:5432/${TEST_DB}`;
// Connects as the documented role over TCP, so it also proves the password is set.
const PG_ENV = { ...process.env, PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '3' };

const done = [];     // things this run changed
const ready = [];    // things that were already in place
const failed = [];   // toolchain failures: typecheck/lint output is untrustworthy
const warnings = []; // database failures: only DB-backed gates are affected

function run(cmd, args, { env = process.env, cwd = ROOT, timeoutMs = 60_000 } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ok = !result.error && result.status === 0;
  return { ok, stdout: (result.stdout ?? '').trim(), detail: ok ? '' : describeFailure(result) };
}

/** The tail of the command's own output, so the reader sees the real error. */
function describeFailure(result) {
  if (result.error?.code === 'ETIMEDOUT') return 'timed out';
  if (result.error) return result.error.code ?? result.error.message;
  const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim().split('\n');
  const tail = output.slice(-12).map((line) => `      ${line}`).join('\n');
  return `exit ${result.status}${tail ? `\n${tail}` : ''}`;
}

function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function ensureDependencies() {
  if (existsSync(join(ROOT, 'node_modules/.package-lock.json'))) {
    ready.push('node_modules');
    return true;
  }
  const r = run('npm', ['ci', '--no-audit', '--no-fund'], { timeoutMs: 480_000 });
  if (!r.ok) {
    failed.push(`npm ci failed: ${r.detail}`);
    return false;
  }
  done.push('installed dependencies (npm ci)');
  return true;
}

function ensurePrismaClient() {
  // `prisma generate` copies the schema it generated from into the client.
  const generatedSchema = join(ROOT, 'node_modules/.prisma/client/schema.prisma');
  const current = readOrNull(SCHEMA);
  if (current !== null && readOrNull(generatedSchema) === current) {
    ready.push('Prisma client');
    return;
  }
  const r = run(PRISMA_BIN, ['generate', `--schema=${SCHEMA}`], { timeoutMs: 180_000 });
  if (!r.ok) {
    failed.push(`prisma generate failed: ${r.detail}`);
    return;
  }
  if (readOrNull(generatedSchema) !== current) {
    failed.push(`prisma generate exited 0 but ${generatedSchema} does not match schema.prisma`);
    return;
  }
  done.push('generated the Prisma client');
}

function ensurePostgresRunning() {
  if (run('pg_isready', ['-q']).ok) {
    ready.push('Postgres');
    return true;
  }
  // `16 main 5432 down postgres ...` -> start every cluster that is down.
  const clusters = run('pg_lsclusters', ['--no-header']);
  if (!clusters.ok) {
    warnings.push(`Postgres is not running and pg_lsclusters failed: ${clusters.detail}`);
    return false;
  }
  for (const line of clusters.stdout.split('\n').filter(Boolean)) {
    const [version, name, , status] = line.trim().split(/\s+/);
    if (status === 'online') continue;
    const r = run('pg_ctlcluster', [version, name, 'start']);
    if (!r.ok) {
      warnings.push(`pg_ctlcluster ${version} ${name} start failed: ${r.detail}`);
      return false;
    }
  }
  if (!run('pg_isready', ['-q', '-t', '10']).ok) {
    warnings.push('started the Postgres cluster but pg_isready still reports no response');
    return false;
  }
  done.push('started Postgres');
  return true;
}

function asPostgresUser(sql) {
  return run('su', ['postgres', '-c', `psql -v ON_ERROR_STOP=1 -qc "${sql}"`]);
}

function psql(database, sql) {
  return run('psql', ['-h', 'localhost', '-U', 'postgres', '-d', database, '-tAc', sql], { env: PG_ENV });
}

function ensureTestDatabase() {
  let probe = psql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'`);
  if (!probe.ok) {
    // Most likely the role has no password yet; peer auth as the OS user can set it.
    const r = asPostgresUser("ALTER USER postgres WITH PASSWORD 'postgres'");
    if (!r.ok) {
      warnings.push(`cannot connect as postgres:postgres and setting the password failed: ${r.detail}`);
      return false;
    }
    probe = psql('postgres', `SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'`);
    if (!probe.ok) {
      warnings.push(`set the postgres password but still cannot connect: ${probe.detail}`);
      return false;
    }
    done.push('set the postgres role password');
  }
  if (probe.stdout === '1') return true;

  const r = run('su', ['postgres', '-c', `createdb ${TEST_DB}`]);
  if (!r.ok) {
    warnings.push(`createdb ${TEST_DB} failed: ${r.detail}`);
    return false;
  }
  done.push(`created ${TEST_DB}`);
  return true;
}

function ensureMigrations(prismaAvailable) {
  const expected = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length;
  // Fails when _prisma_migrations does not exist yet, i.e. nothing applied.
  const applied = psql(
    TEST_DB,
    'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  if (applied.ok && Number(applied.stdout) >= expected) {
    ready.push(`${TEST_DB} (${expected} migrations)`);
    return;
  }
  if (!prismaAvailable) {
    warnings.push(`${TEST_DB} needs migrations, but the Prisma CLI is unavailable (see FAILED above)`);
    return;
  }
  const r = run(PRISMA_BIN, ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: join(ROOT, 'packages/core-api'),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    timeoutMs: 300_000,
  });
  if (!r.ok) {
    warnings.push(`prisma migrate deploy against ${TEST_DB} failed: ${r.detail}`);
    return;
  }
  const before = applied.ok ? Number(applied.stdout) : 0;
  done.push(`applied ${expected - before} migration(s) to ${TEST_DB} (prisma migrate deploy)`);
}

function report() {
  const lines = [];
  if (failed.length > 0) {
    lines.push(
      'Session setup FAILED -- typecheck and lint output is NOT trustworthy until this is fixed.',
      'Errors like "Cannot find module" or "@prisma/client has no exported member" mean missing',
      'setup, not broken code. Do not edit source to make them go away.',
      ...failed.map((f) => `  FAILED: ${f}`),
    );
  } else {
    lines.push('Session setup complete.');
  }
  if (done.length > 0) lines.push(`  Did: ${done.join('; ')}`);
  if (ready.length > 0) lines.push(`  Already ready: ${ready.join(', ')}`);
  if (warnings.length > 0) {
    lines.push(
      ...warnings.map((w) => `  WARNING: ${w}`),
      '  The database is needed only by integration, functional and merged-coverage gates.',
    );
  } else {
    lines.push(`  Test database: ${TEST_DB_URL}`);
  }
  lines.push('  Never use `npm run db:test:reset` or the `:fresh` scripts here: Prisma refuses `migrate reset`');
  lines.push('  from an agent. Use `npm run db:test:migrate` (migrate deploy) instead.');
  const text = lines.join('\n');
  process.stdout.write(JSON.stringify({
    systemMessage: text,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
  }));
}

function main() {
  if (process.env.CLAUDE_CODE_REMOTE !== 'true') return;

  const depsOk = ensureDependencies();
  if (depsOk) ensurePrismaClient();
  else failed.push('skipped prisma generate: dependencies are not installed');

  if (ensurePostgresRunning() && ensureTestDatabase()) {
    ensureMigrations(depsOk && existsSync(PRISMA_BIN));
  }
  report();
}

main();
