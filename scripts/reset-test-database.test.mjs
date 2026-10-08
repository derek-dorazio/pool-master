import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTestDatabaseUrl, databaseName } from './reset-test-database.mjs';

test('a URL naming a database that ends in _test is accepted for reset', () => {
  assert.doesNotThrow(() => assertTestDatabaseUrl('postgresql://postgres:postgres@localhost:5432/poolmaster_test'));
});

test('the dev database is refused for reset', () => {
  assert.throws(
    () => assertTestDatabaseUrl('postgresql://postgres:postgres@localhost:5432/poolmaster'),
    /Refusing to reset poolmaster: only a database whose name ends in _test/,
  );
});

test('a URL naming no database, or no URL at all, is refused for reset', () => {
  assert.throws(() => assertTestDatabaseUrl('postgresql://postgres:postgres@localhost:5432/'), /an unnamed database/);
  assert.throws(() => assertTestDatabaseUrl('not a url'), /an unnamed database/);
});

test('the database name is read from the URL path, ignoring query parameters', () => {
  assert.equal(databaseName('postgresql://u:p@host:5432/poolmaster_test?schema=public'), 'poolmaster_test');
});
