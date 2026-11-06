import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { migrationPlan, parseMigrationRows } from './session-start-environment.mjs';

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
const oldHistory = Array.from({ length: 217 }, (_, i) => `2025${String(i).padStart(10, '0')}_old_${i}`);

describe('session-start hook migration plan', () => {
  it('resets a test database built by the pre-squash history even though it has more rows than the tree has migrations', () => {
    const plan = migrationPlan(baselines, oldHistory.map(applied));
    assert.equal(plan.action, 'reset');
    assert.match(plan.reason, /217 applied migration\(s\) this branch does not carry/);
  });

  it('resets when an applied migration was removed from the branch, even if every branch migration is applied', () => {
    const plan = migrationPlan(baselines, [...baselines, '20260101000000_dropped'].map(applied));
    assert.equal(plan.action, 'reset');
  });

  it('resets when a migration is recorded as unfinished, since deploy refuses that history with P3009', () => {
    const plan = migrationPlan(baselines, [
      applied(baselines[0]),
      { migration_name: baselines[1], finished_at: null, rolled_back_at: null },
    ]);
    assert.equal(plan.action, 'reset');
    assert.match(plan.reason, /unfinished or rolled back/);
  });

  it('deploys when the branch adds a migration the database has not applied yet', () => {
    const plan = migrationPlan([...baselines, '20270201000000_new'], baselines.map(applied));
    assert.deepEqual(plan, { action: 'deploy', pending: 1 });
  });

  it('deploys every migration to a database that has never been migrated', () => {
    assert.deepEqual(migrationPlan(baselines, []), { action: 'deploy', pending: 2 });
  });

  it('is ready when exactly the branch migrations are applied', () => {
    assert.deepEqual(migrationPlan(baselines, baselines.map(applied)), { action: 'ready' });
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
