import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { BASELINES, findRaises, resolveBaseRef } from './check-baseline-ratchet.mjs';

const read = (file) => BASELINES.find((baseline) => baseline.file === file).read;

describe('check-baseline-ratchet (#1619)', () => {
  it('reports an entry raised by hand, with what it was and what it is now', () => {
    const base = new Map([['a.tsx', 3], ['b.tsx', 1]]);
    const head = new Map([['a.tsx', 4], ['b.tsx', 1]]);
    assert.deepEqual(findRaises(base, head), [{ key: 'a.tsx', was: 3, now: 4 }]);
  });

  it('reports a file the base does not list as raised from 0', () => {
    assert.deepEqual(findRaises(new Map([['a.tsx', 3]]), new Map([['a.tsx', 3], ['new.tsx', 2]])), [{ key: 'new.tsx', was: 0, now: 2 }]);
  });

  it('passes entries lowered or removed, which is the ratchet working', () => {
    assert.deepEqual(findRaises(new Map([['a.tsx', 3], ['b.tsx', 1]]), new Map([['a.tsx', 1]])), []);
  });

  it('reads a per-file baseline as its counts, leaving out a $comment', () => {
    const entries = read('scripts/text-style-baseline.json')('{"$comment":"x","a.tsx":2}');
    assert.deepEqual([...entries], [['a.tsx', 2]]);
  });

  it('reads the duplicate baseline per pair of files, whichever order the pair is written in', () => {
    const readPairs = read('scripts/duplicate-baseline.json');
    const base = readPairs(JSON.stringify({ pairs: [{ files: ['b.ts', 'a.ts'], count: 1, reason: 'r' }] }));
    const head = readPairs(JSON.stringify({ pairs: [{ files: ['a.ts', 'b.ts'], count: 2, reason: 'r' }] }));
    assert.deepEqual(findRaises(base, head), [{ key: 'a.ts + b.ts', was: 1, now: 2 }]);
  });

  it('reads the query-states list as one entry per listed file, so a file added back is caught', () => {
    const readList = read('eslint-rules/query-states-baseline.mjs');
    const base = readList("/**\n * 'not/a/file.tsx' in a comment\n */\nexport const X = [\n  'a.tsx',\n];\n");
    const head = readList("export const X = [\n  'a.tsx',\n  'b.tsx',\n];\n");
    assert.deepEqual(findRaises(base, head), [{ key: 'b.tsx', was: 0, now: 1 }]);
  });

  it('reads every real baseline file without losing an entry', () => {
    for (const { file, read: readBaseline } of BASELINES) {
      const entries = readBaseline(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
      assert.ok(entries.size > 0, `${file} read as empty`);
    }
    const listed = readFileSync(new URL('../eslint-rules/query-states-baseline.mjs', import.meta.url), 'utf8');
    const quotedPaths = listed.match(/'clients\/poolmaster\/[^']+'/g) ?? [];
    assert.equal(read('eslint-rules/query-states-baseline.mjs')(listed).size, quotedPaths.length);
  });

  it('measures against HEAD^1 in CI, the merge-base with origin/main locally, and an override over both', () => {
    assert.equal(resolveBaseRef({ CI: 'true' }, () => 'abc'), 'HEAD^1');
    assert.equal(resolveBaseRef({}, (ref) => (ref === 'origin/main' ? 'abc' : null)), 'abc');
    assert.equal(resolveBaseRef({ CI: 'true', BASELINE_BASE_REF: 'v1' }, () => 'abc'), 'v1');
  });
});
