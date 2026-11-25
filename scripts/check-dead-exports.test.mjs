import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyExports, compareWithBaseline, entriesFor, exportedNames, identifierCounts, isTestLike, ratchetBaseline, renamedSpecifiers } from './check-dead-exports.mjs';

const file = (text, exports = null, path = 'x.ts') => ({ identifiers: identifierCounts(path, text), exports, renames: renamedSpecifiers(path, text) });

describe('check-dead-exports (#2111)', () => {
  it('lists exported values, leaving out types, default exports, enum order lists built by explicitOrder or alphabeticalOrder, and marked test hooks', () => {
    const text = [
      'export const LIMIT = 3;',
      'export function used() {}',
      'export type Shape = { a: string };',
      'export interface Other { b: number }',
      'export const ContestStatusOrder = explicitOrder<ContestStatus>({ OPEN: 0 });',
      'export const ParticipantTypeOrder = alphabeticalOrder(\'ParticipantType\') as const;',
      'export const sortOrder = [];',
      'export default function Page() {}',
      'const local = 1;',
      'export { local };',
      '// poolmaster-allow-test-export: module state the tests reset',
      'export function resetForTests() {}',
    ].join('\n');
    assert.deepEqual(exportedNames('src/a.ts', text), ['LIMIT', 'used', 'sortOrder', 'local']);
  });

  it('classifies an export no file names as unused, one only tests name as tests-only, and one a production file names as alive', () => {
    const files = new Map([
      ['packages/core-api/src/a.ts', file('export const dead = 1; export const testOnly = 2; export const alive = 3;', ['dead', 'testOnly', 'alive'])],
      ['packages/core-api/src/b.ts', file("import { alive } from './a'; alive;")],
      ['tests/unit/a.test.ts', file("import { testOnly } from '../../packages/core-api/src/a';\nexpect(testOnly).toBe(2);")],
    ]);
    assert.deepEqual(classifyExports(files), [
      { file: 'packages/core-api/src/a.ts', name: 'dead', kind: 'unused' },
      { file: 'packages/core-api/src/a.ts', name: 'testOnly', kind: 'tests-only' },
    ]);
  });

  it('reports an export that only a barrel re-exports, or that another file names only in a comment or a string, as unused', () => {
    const files = new Map([
      ['packages/core-api/src/jobs/queue.ts', file('export const viaBarrel = 1; export const inComment = 2; export const inString = 3;', ['viaBarrel', 'inComment', 'inString'])],
      ['packages/core-api/src/jobs/index.ts', file("export { viaBarrel } from './queue';\nexport * as queue from './queue';\nimport { inString } from './queue';")],
      ['packages/core-api/src/other.ts', file("// see inComment\nconst label = 'inString';\nlabel;")],
    ]);
    assert.deepEqual(classifyExports(files).map(({ name, kind }) => `${name}:${kind}`), ['viaBarrel:unused', 'inComment:unused', 'inString:unused']);
  });

  it('counts a re-exported name as alive once code that imports it through the barrel reads it', () => {
    const files = new Map([
      ['packages/core-api/src/jobs/queue.ts', file('export const enqueue = () => {};', ['enqueue'])],
      ['packages/core-api/src/jobs/index.ts', file("export { enqueue } from './queue';")],
      ['packages/core-api/src/app.ts', file("import { enqueue } from './jobs';\nenqueue();")],
    ]);
    assert.deepEqual(classifyExports(files), []);
  });

  it('counts an export passed on under a new name as alive once code reads the new name, and as unused while nothing does', () => {
    const files = new Map([
      ['packages/core-api/src/jobs/queue.ts', file('export const enqueue = () => {}; export const drain = () => {};', ['enqueue', 'drain'])],
      ['packages/core-api/src/jobs/index.ts', file("export { enqueue as addJob, drain as drainQueue } from './queue';")],
      ['packages/core-api/src/app.ts', file("import { addJob } from './jobs';\naddJob();")],
    ]);
    assert.deepEqual(classifyExports(files).map(({ name, kind }) => `${name}:${kind}`), ['drain:unused']);
  });

  it('counts an export imported under a new name as alive once the importing code reads that name', () => {
    const files = new Map([
      ['packages/core-api/src/jobs/queue.ts', file('export const enqueue = () => {};', ['enqueue'])],
      ['packages/core-api/src/app.ts', file("import { enqueue as addJob } from './jobs/queue';\naddJob();")],
    ]);
    assert.deepEqual(classifyExports(files), []);
  });

  it('does not count other files reading a common word as reads of an export imported under that word by a file that never reads it', () => {
    const files = new Map([
      ['packages/core-api/src/jobs/queue.ts', file('export const enqueue = () => {};', ['enqueue'])],
      ['packages/core-api/src/app.ts', file("import { enqueue as id } from './jobs/queue';")],
      ['packages/core-api/src/other.ts', file('const id = 1;\nid;')],
    ]);
    assert.deepEqual(classifyExports(files).map(({ name, kind }) => `${name}:${kind}`), ['enqueue:unused']);
  });

  it('counts an export its own file uses, and no other production file does, as own-file only, even when a test reads it too', () => {
    const files = new Map([
      ['clients/poolmaster/src/a.ts', file('export function helper() {} export function main() { return helper(); }', ['helper', 'main'])],
      ['clients/poolmaster/src/b.tsx', file('main();')],
      ['clients/poolmaster/src/a.test.ts', file('helper();')],
    ]);
    assert.deepEqual(classifyExports(files), [{ file: 'clients/poolmaster/src/a.ts', name: 'helper', kind: 'own-file' }]);
  });

  it('treats tests, stories, test folders and fixture files as tests, and a file merely named with "test" in a word as production', () => {
    assert.equal(isTestLike('clients/poolmaster/src/a.test.tsx'), true);
    assert.equal(isTestLike('clients/poolmaster/src/a.stories.tsx'), true);
    assert.equal(isTestLike('clients/poolmaster/src/features/contests/test/fixture.ts'), true);
    assert.equal(isTestLike('clients/poolmaster/src/features/root-admin/sport-test-fixtures.ts'), true);
    assert.equal(isTestLike('clients/poolmaster/src/features/root-admin/bracket-test-context.tsx'), true);
    assert.equal(isTestLike('packages/core-api/src/modules/email/email-test-routes.ts'), false);
    assert.equal(isTestLike('clients/poolmaster/src/features/contests/create-contest/create-contest-helpers.ts'), false);
  });

  it('keys a dead export by file and name and counts own-file exports per file, failing a new entry and asking to lower a removed one', () => {
    const entries = entriesFor([
      { file: 'a.ts', name: 'x', kind: 'unused' },
      { file: 'a.ts', name: 'y', kind: 'own-file' },
      { file: 'a.ts', name: 'z', kind: 'own-file' },
    ]);
    assert.deepEqual(entries, { 'dead:a.ts#x': 1, 'own:a.ts': 2 });
    const { over, under } = compareWithBaseline(entries, { 'own:a.ts': 3, 'dead:b.ts#gone': 1 });
    assert.deepEqual(over, [{ key: 'dead:a.ts#x', now: 1, allowed: 0 }]);
    assert.deepEqual(under.map((u) => u.key).sort(), ['dead:b.ts#gone', 'own:a.ts']);
  });

  it('only lowers the baseline on update, dropping entries at 0 and never adding or raising one', () => {
    assert.deepEqual(ratchetBaseline({ 'own:a.ts': 1, 'dead:new.ts#n': 1, 'own:c.ts': 9 }, { 'own:a.ts': 2, 'dead:b.ts#g': 1, 'own:c.ts': 3 }), { 'own:a.ts': 1, 'own:c.ts': 3 });
  });
});
