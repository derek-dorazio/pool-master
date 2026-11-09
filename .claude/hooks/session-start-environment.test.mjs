import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isRunAsHook, migrationPlan, parseMigrationRows, parseSchemaProbe } from './session-start-environment.mjs';

/**
 * #1431 — what the cloud session-start hook does to poolmaster_test.
 *
 * It used to call the database ready when the count of applied migrations reached the count of
 * migration directories. After #1429 squashed 217 migrations into 2 baselines, a long-lived test
 * database built by the old history counted as ready (217 >= 2) while holding none of the
 * baselines, so DB-backed gates ran against the old schema. The plan compares names instead.
 */
const baselines = ['20270107000000_baseline_schema', '20270107000100_baseline_reference_data'];
const applied = (name) => ({ migration_name: name, finished_at: '2026-11-01 10:00:00+00', rolled_back_at: null });
const migrated = (recorded) => ({ recorded, publicTables: 1 });
const oldHistory = Array.from({ length: 217 }, (_, i) => `2025${String(i).padStart(10, '0')}_old_${i}`);

describe('session-start hook migration plan', () => {
  it('resets a test database built by the pre-squash history even though it has more rows than the tree has migrations', () => {
    const plan = migrationPlan(baselines, migrated(oldHistory.map(applied)));
    assert.equal(plan.action, 'reset');
    assert.match(plan.reason, /217 applied migration\(s\) this branch does not carry/);
  });

  it('resets when an applied migration was removed from the branch, even if every branch migration is applied', () => {
    const plan = migrationPlan(baselines, migrated([...baselines, '20260101000000_dropped'].map(applied)));
    assert.equal(plan.action, 'reset');
  });

  it('resets when a migration is recorded as unfinished, since deploy refuses that history with P3009', () => {
    const plan = migrationPlan(baselines, migrated([
      applied(baselines[0]),
      { migration_name: baselines[1], finished_at: null, rolled_back_at: null },
    ]));
    assert.equal(plan.action, 'reset');
    assert.match(plan.reason, /unfinished or rolled back/);
  });

  it('deploys when the branch adds a migration the database has not applied yet', () => {
    const plan = migrationPlan([...baselines, '20270201000000_new'], migrated(baselines.map(applied)));
    assert.deepEqual(plan, { action: 'deploy', pending: 1 });
  });

  it('deploys every migration to an empty database that has never been migrated', () => {
    assert.deepEqual(migrationPlan(baselines, { recorded: null, publicTables: 0 }), { action: 'deploy', pending: 2 });
  });

  it('deploys when the migrations table exists but is empty and nothing else is in public', () => {
    assert.deepEqual(migrationPlan(baselines, migrated([])), { action: 'deploy', pending: 2 });
  });

  // #1434: tables left by `prisma db push` (or a manual restore) with no _prisma_migrations make
  // `migrate deploy` fail with P3005 ("The database schema is not empty"), so the hook only warned.
  it('resets a database whose public schema has tables but no migration history, since deploy refuses it with P3005', () => {
    const plan = migrationPlan(baselines, { recorded: null, publicTables: 42 });
    assert.equal(plan.action, 'reset');
    assert.match(plan.reason, /42 table\(s\) in public but no _prisma_migrations/);
  });

  it('is ready when exactly the branch migrations are applied', () => {
    assert.deepEqual(migrationPlan(baselines, migrated(baselines.map(applied))), { action: 'ready' });
  });
});

describe('session-start hook _prisma_migrations parsing', () => {
  it('reads psql unaligned rows, treating an empty column as null', () => {
    const stdout = [
      '20270107000000_baseline_schema|2026-11-01 10:00:00+00|',
      '20270107000100_baseline_reference_data||',
      '20260101000000_x|2026-11-01 10:00:00+00|2026-11-01 11:00:00+00',
    ].join('\n');
    assert.deepEqual(parseMigrationRows(stdout), [
      { migration_name: '20270107000000_baseline_schema', finished_at: '2026-11-01 10:00:00+00', rolled_back_at: null },
      { migration_name: '20270107000100_baseline_reference_data', finished_at: null, rolled_back_at: null },
      { migration_name: '20260101000000_x', finished_at: '2026-11-01 10:00:00+00', rolled_back_at: '2026-11-01 11:00:00+00' },
    ]);
  });

  it('reads an empty table as no rows', () => {
    assert.deepEqual(parseMigrationRows(''), []);
  });
});

describe('session-start hook schema probe parsing', () => {
  it('reads a database with a migrations table and its count of other public tables', () => {
    assert.deepEqual(parseSchemaProbe('t|57'), { hasMigrationsTable: true, publicTables: 57 });
  });

  it('reads a database with tables but no migrations table', () => {
    assert.deepEqual(parseSchemaProbe('f|12'), { hasMigrationsTable: false, publicTables: 12 });
  });

  it('reads an empty database as no migrations table and no tables', () => {
    assert.deepEqual(parseSchemaProbe('f|0'), { hasMigrationsTable: false, publicTables: 0 });
  });

  it('throws on output it does not recognise rather than guessing the database is empty', () => {
    assert.throws(() => parseSchemaProbe(''), /Unrecognised schema probe output/);
    assert.throws(() => parseSchemaProbe('t|many'), /Unrecognised schema probe output/);
  });
});

describe('session-start hook run-as-main guard', () => {
  const hookPath = fileURLToPath(new URL('./session-start-environment.mjs', import.meta.url));
  const hookUrl = new URL('./session-start-environment.mjs', import.meta.url).href;

  it('runs when executed by its real path', () => {
    assert.equal(isRunAsHook(hookPath, hookUrl), true);
  });

  it('still runs when the project directory is reached through a symlink, so setup is never silently skipped', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'hook-symlink-'));
    try {
      const alias = join(scratch, 'alias');
      symlinkSync(dirname(hookPath), alias);
      assert.equal(isRunAsHook(join(alias, 'session-start-environment.mjs'), hookUrl), true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('does not run when imported by another script, such as this test', () => {
    assert.equal(isRunAsHook(fileURLToPath(import.meta.url), hookUrl), false);
    assert.equal(isRunAsHook(undefined, hookUrl), false);
  });
});
