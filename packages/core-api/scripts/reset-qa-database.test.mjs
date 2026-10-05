import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertQaDatabaseUrl,
  compareMigrationState,
  migrationsInImage,
} from './reset-qa-database.mjs';

/**
 * #83 — the guards in front of destroying every row in a database.
 *
 * `compareMigrationState` is the other half: it decides whether a finished reset actually left
 * the history this image expects. A reset that reported success while leaving a failed or
 * unknown migration behind would recreate the P3009 state it exists to clear.
 */
describe('reset-qa-database guards', () => {
  it('refuses a missing DATABASE_URL', () => {
    assert.throws(() => assertQaDatabaseUrl(undefined), /DATABASE_URL is required/);
    assert.throws(() => assertQaDatabaseUrl(''), /DATABASE_URL is required/);
  });

  it('refuses a database that does not look like QA', () => {
    assert.throws(
      () => assertQaDatabaseUrl('postgresql://u:p@prod-postgres.example.com:5432/poolmaster'),
      /does not look like the QA RDS endpoint/,
    );
  });

  it('accepts the QA endpoint', () => {
    assert.doesNotThrow(
      () => assertQaDatabaseUrl('postgresql://u:p@poolmaster-qa-postgres.abc.us-east-2.rds.amazonaws.com:5432/poolmaster'),
    );
  });

  // The escape hatch is deliberately not the default and deliberately not implied by --apply:
  // pointing this at a local database should take saying so.
  it('accepts a non-QA database only with the explicit opt-out', () => {
    assert.doesNotThrow(() => assertQaDatabaseUrl('postgresql://u:p@localhost:5432/x', 'true'));
    assert.throws(() => assertQaDatabaseUrl('postgresql://u:p@localhost:5432/x', 'yes'), /does not look like/);
  });
});

describe('reset-qa-database migration-state verification', () => {
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

describe('reset-qa-database image inventory', () => {
  // Reads the real migrations directory: the comparison above is only meaningful if the list it
  // compares against is the one Prisma will apply. Resolved from this file rather than the cwd,
  // because `npm run test:scripts` runs from the repository root while the script itself runs
  // from packages/core-api, the way every other script here takes its relative paths.
  it('lists this repository\'s migrations in applied order', () => {
    const names = migrationsInImage(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
    assert.ok(names.length > 70, `expected the real migration set, got ${names.length}`);
    assert.deepEqual(names, [...names].sort(), 'must be in timestamp order');
    assert.ok(names.includes('20261003180000_collapse_season_into_event_year'));
    assert.ok(!names.includes('migration_lock.toml'), 'files are not migrations');
  });
});
