import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareMigrationState } from './migration-state.mjs';

/**
 * The comparison the QA reset verifies with, QA's migrate task refuses a rewritten history with,
 * and the cloud session-start hook decides between deploy and reset with. A comparison that
 * called a failed or unknown migration clean would recreate the P3009 state all three exist to end.
 */
describe('compareMigrationState', () => {
  const inImage = ['20260101000000_a', '20260202000000_b'];
  const applied = (name) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });

  it('is clean when every image migration is applied and nothing else is recorded', () => {
    assert.deepEqual(
      compareMigrationState(inImage, inImage.map(applied)),
      { missing: [], unexpected: [], unfinished: [] },
    );
  });

  it('reports a migration the image has but the database did not apply', () => {
    const state = compareMigrationState(inImage, [applied('20260101000000_a')]);
    assert.deepEqual(state.missing, ['20260202000000_b']);
  });

  it('reports a migration the database records that the image does not have', () => {
    const state = compareMigrationState(inImage, [...inImage.map(applied), applied('20250101000000_gone')]);
    assert.deepEqual(state.unexpected, ['20250101000000_gone']);
  });

  // The exact state that made plans/147's refusal unrecoverable: a row present but unfinished,
  // which Prisma answers P3009 to on every later deploy.
  it('reports an unfinished migration, which is the P3009 state', () => {
    const state = compareMigrationState(inImage, [
      applied('20260101000000_a'),
      { migration_name: '20260202000000_b', finished_at: null, rolled_back_at: null },
    ]);
    assert.deepEqual(state.unfinished, ['20260202000000_b']);
    assert.deepEqual(state.missing, ['20260202000000_b']);
  });

  it('treats a rolled-back migration as not applied', () => {
    const state = compareMigrationState(inImage, [
      applied('20260101000000_a'),
      { migration_name: '20260202000000_b', finished_at: new Date(), rolled_back_at: new Date() },
    ]);
    assert.deepEqual(state.missing, ['20260202000000_b']);
    assert.deepEqual(state.unfinished, ['20260202000000_b']);
  });

  it('is clean against an empty database, which has no history at all', () => {
    assert.deepEqual(compareMigrationState([], []), { missing: [], unexpected: [], unfinished: [] });
  });
});
