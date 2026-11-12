import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { historyMismatch, isMissingMigrationsTable } from './run-migrations.mjs';

// #1429 squashed the migration history into a baseline. A database migrated by the old history
// records names the new image does not carry, and `migrate deploy` would fail on it with a raw
// SQL error; the migrate task has to name the way out instead.
describe('run-migrations history check', () => {
  const inImage = ['20271119000000_baseline_schema', '20271119000100_baseline_reference_data'];
  const applied = (name) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });

  it('lets a never-migrated database deploy', () => {
    assert.equal(historyMismatch(inImage, []), null);
  });

  it('lets a database that applied part of this image deploy the rest', () => {
    assert.equal(historyMismatch(inImage, [applied(inImage[0])]), null);
  });

  it('stops a database migrated by the pre-squash history and tells the reader to reset QA', () => {
    const message = historyMismatch(inImage, [
      applied('20260327130533_init'),
      applied('20260330013647_add_missing_columns'),
    ]);
    assert.match(message, /2 applied migration\(s\) this image does not carry/);
    assert.match(message, /20260327130533_init/);
    assert.match(message, /Reset QA database/);
  });

  it('names five unknown migrations and counts the rest, so a long old history stays readable', () => {
    const old = Array.from({ length: 217 }, (_, i) => applied(`2026${String(i).padStart(10, '0')}_old`));
    const message = historyMismatch(inImage, old);
    assert.match(message, /217 applied migration\(s\)/);
    assert.match(message, /and 212 more/);
  });

  it('ignores a rolled-back migration the image does not carry, since it was never applied', () => {
    const rolledBack = { migration_name: '20260101000000_gone', finished_at: new Date(), rolled_back_at: new Date() };
    assert.equal(historyMismatch(inImage, [rolledBack]), null);
  });
});

describe('run-migrations reading the recorded history', () => {
  it('reads a missing _prisma_migrations table as a never-migrated database', () => {
    assert.equal(isMissingMigrationsTable({ code: 'P2010', meta: { code: '42P01' } }), true);
  });

  it('does not read a connection, auth or other query error as an empty history', () => {
    assert.equal(isMissingMigrationsTable({ code: 'P1001' }), false);
    assert.equal(isMissingMigrationsTable({ code: 'P1000' }), false);
    assert.equal(isMissingMigrationsTable({ code: 'P2010', meta: { code: '42501' } }), false);
    assert.equal(isMissingMigrationsTable(new Error('boom')), false);
  });
});
