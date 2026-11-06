import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertQaDatabaseUrl,
  migrationsInImage,
} from './reset-qa-database.mjs';

/**
 * #83 — the guards in front of destroying every row in a database.
 *
 * Whether a finished reset left the history this image expects is `compareMigrationState`,
 * tested in migration-state.test.mjs.
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

describe('reset-qa-database image inventory', () => {
  // Reads the real migrations directory: the comparison above is only meaningful if the list it
  // compares against is the one Prisma will apply. Resolved from this file rather than the cwd,
  // because `npm run test:scripts` runs from the repository root while the script itself runs
  // from packages/core-api, the way every other script here takes its relative paths.
  it('lists this repository\'s migrations in applied order', () => {
    const names = migrationsInImage(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
    assert.deepEqual(names, [...names].sort(), 'must be in timestamp order');
    assert.equal(names[0], '20270107000000_baseline_schema', 'the squashed baseline comes first');
    assert.ok(names.includes('20270107000100_baseline_reference_data'));
    assert.ok(!names.includes('migration_lock.toml'), 'files are not migrations');
  });
});
