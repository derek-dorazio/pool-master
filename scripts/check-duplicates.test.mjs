import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkCeiling, compareWithBaseline, countByPair, pairKey } from './check-duplicates.mjs';

const leaderboards = { fileA: 'src/pick-em-leaderboard.tsx', fileB: 'src/survivor-leaderboard.tsx' };

describe('check-duplicates (#1287)', () => {
  it('names a pair of files the same whichever file the detector lists first', () => {
    assert.equal(pairKey('b.tsx', 'a.tsx'), pairKey('a.tsx', 'b.tsx'));
  });

  it('counts every copy between the same two files, in either order, as one pair', () => {
    const counts = countByPair([leaderboards, { fileA: leaderboards.fileB, fileB: leaderboards.fileA }]);
    assert.deepEqual([...counts.values()], [2]);
  });

  it('passes when every copy is in the baseline', () => {
    const baseline = [{ files: [leaderboards.fileB, leaderboards.fileA], count: 1, ticket: '#1277' }];
    assert.deepEqual(compareWithBaseline([leaderboards], baseline), { added: [], removed: [] });
  });

  it('reports a copy between files the baseline does not name as new', () => {
    const { added } = compareWithBaseline([{ fileA: 'src/a.tsx', fileB: 'src/b.tsx' }], []);
    assert.deepEqual(added, [{ key: 'src/a.tsx <> src/b.tsx', count: 1, allowed: 0 }]);
  });

  it('reports one more copy between files already in the baseline as new', () => {
    const baseline = [{ files: [leaderboards.fileA, leaderboards.fileB], count: 1, ticket: '#1277' }];
    const { added } = compareWithBaseline([leaderboards, leaderboards], baseline);
    assert.equal(added.length, 1);
    assert.equal(added[0].allowed, 1);
  });

  it('reports a baseline entry whose copies a PR removed, so the entry has to shrink with it', () => {
    const baseline = [{ files: [leaderboards.fileA, leaderboards.fileB], count: 2, ticket: '#1277' }];
    const { added, removed } = compareWithBaseline([leaderboards], baseline);
    assert.deepEqual(added, []);
    assert.deepEqual(removed, [{ key: pairKey(leaderboards.fileA, leaderboards.fileB), count: 1, allowed: 2, ticket: '#1277' }]);
  });

  it('passes when the baseline allows exactly the ceiling', () => {
    assert.equal(checkCeiling([{ files: ['a', 'b'], count: 2 }, { files: ['a', 'c'], count: 1 }], 3), null);
  });

  it('fails when the baseline allows more copies than the ceiling, so a new entry or a raised count cannot slip in', () => {
    assert.match(checkCeiling([{ files: ['a', 'b'], count: 4 }], 3), /over a ceiling of 3/);
  });

  it('asks to lower the ceiling when the baseline holds fewer copies than it', () => {
    assert.match(checkCeiling([{ files: ['a', 'b'], count: 2 }], 3), /Lower BASELINE_CEILING to 2/);
  });
});
