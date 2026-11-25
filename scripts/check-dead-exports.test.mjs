import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyExports, compareWithBaseline, entriesFor, exportedNames, identifierCounts, isTestLike, ratchetBaseline } from './check-dead-exports.mjs';

const file = (text, exports = null) => ({ identifiers: identifierCounts(text), exports });

describe('check-dead-exports (#2111)', () => {
  it('lists exported values, leaving out types, default exports, enum order lists and marked test hooks', () => {
    const text = [
      'export const LIMIT = 3;',
      'export function used() {}',
      'export type Shape = { a: string };',
      'export interface Other { b: number }',
      'export const ContestStatusOrder = [];',
      'export default function Page() {}',
      'const local = 1;',
      'export { local };',
      '// poolmaster-allow-test-export: module state the tests reset',
      'export function resetForTests() {}',
    ].join('\n');
    assert.deepEqual(exportedNames('src/a.ts', text), ['LIMIT', 'used', 'local']);
  });

  it('classifies an export no file names as unused, one only tests name as tests-only, and one a production file names as alive', () => {
    const files = new Map([
      ['packages/core-api/src/a.ts', file('export const dead = 1; export const testOnly = 2; export const alive = 3;', ['dead', 'testOnly', 'alive'])],
      ['packages/core-api/src/b.ts', file("import { alive } from './a'; alive;")],
      ['tests/unit/a.test.ts', file("import { testOnly } from '../../packages/core-api/src/a';")],
    ]);
    assert.deepEqual(classifyExports(files), [
      { file: 'packages/core-api/src/a.ts', name: 'dead', kind: 'unused' },
      { file: 'packages/core-api/src/a.ts', name: 'testOnly', kind: 'tests-only' },
    ]);
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
