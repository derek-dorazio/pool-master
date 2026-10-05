/**
 * #340 — the schema/migration drift gate's decision logic.
 *
 * The database work in `check-schema-migration-drift.mjs` needs a Postgres server and is covered
 * by the CI job that runs it. What is unit-testable, and what the gate is wrong in a dangerous way
 * if it gets wrong, is here: which exit code means drift, which database the check builds on, and
 * whether the failure tells the reader what to do.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  SCRATCH_DATABASE,
  SCHEMA_PATH,
  classifyDiffExit,
  deriveUrls,
  driftMessage,
} from './check-schema-migration-drift.mjs';

const BASE = 'postgresql://poolmaster:poolmaster@localhost:5432/poolmaster_test';

test('#340 exit code 2 is drift, 0 is in sync, and anything else is the tool failing', () => {
  assert.equal(classifyDiffExit(0), 'in-sync');
  assert.equal(classifyDiffExit(2), 'drift');
  // 1 is prisma erroring. Reporting it as drift would send the reader hunting a schema
  // difference that does not exist; reporting it as in-sync would let real drift through.
  assert.equal(classifyDiffExit(1), 'error');
  assert.equal(classifyDiffExit(null), 'error');
});

test('#340 CREATE DATABASE is issued against `postgres`, not the database being created', () => {
  const { maintenanceUrl, scratchUrl } = deriveUrls(BASE);
  assert.equal(new URL(maintenanceUrl).pathname, '/postgres');
  assert.equal(new URL(scratchUrl).pathname, `/${SCRATCH_DATABASE}`);
});

test('#340 the scratch URL keeps the server, port and credentials of the base URL', () => {
  const { scratchUrl } = deriveUrls(BASE);
  const scratch = new URL(scratchUrl);
  assert.equal(scratch.host, 'localhost:5432');
  assert.equal(scratch.username, 'poolmaster');
  assert.equal(scratch.password, 'poolmaster');
});

test('#340 the check never builds on the database DATABASE_URL names', () => {
  // The integration suite's data lives there, and this check drops and recreates what it builds.
  const { scratchUrl } = deriveUrls(BASE);
  assert.notEqual(new URL(scratchUrl).pathname, new URL(BASE).pathname);
});

test('#340 a DATABASE_URL already pointing at the scratch database is refused, not dropped', () => {
  const pointedAtScratch = `postgresql://poolmaster:poolmaster@localhost:5432/${SCRATCH_DATABASE}`;
  assert.throws(() => deriveUrls(pointedAtScratch), /already points at/);
});

test('#340 the drift message names both fix directions and the command that generates one', () => {
  const message = driftMessage('[*] Changed the `sport_leagues` table');
  // The whole point of the gate's message: the diff output alone does not say that the schema and
  // the migrations disagree, nor which of the two to change.
  assert.match(message, /schema\.prisma and the committed migration history disagree/);
  assert.match(message, /The MIGRATIONS are right/);
  assert.match(message, /The SCHEMA is right/);
  assert.match(message, /prisma migrate diff/);
  assert.ok(message.includes(SCHEMA_PATH));
  assert.match(message, /never edit an applied migration/);
  assert.match(message, /npm run db:drift:check/);
});

test('#340 a difference reported with no diff output still produces a message that says so', () => {
  assert.match(driftMessage(''), /printed nothing/);
  assert.doesNotMatch(driftMessage('[*] Changed something'), /printed nothing/);
});
