import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareWithBaseline, countTextStyles, isCheckedSource, ratchetBaseline } from './check-text-styles.mjs';

describe('check-text-styles (#1586)', () => {
  it('reads web app pages but not the shared parts that own text styles, nor tests', () => {
    assert.equal(isCheckedSource('clients/poolmaster/src/features/contests/contest-header.tsx'), true);
    assert.equal(isCheckedSource('clients/poolmaster/src/features/shared/ui/text.tsx'), false);
    assert.equal(isCheckedSource('clients/poolmaster/src/features/contests/contest-header.test.tsx'), false);
    assert.equal(isCheckedSource('packages/core-api/src/app.ts'), false);
  });

  it('counts size, weight, case, figures and text colour classes', () => {
    const source = '<p className="mt-2 text-sm font-medium uppercase tabular-nums text-muted-foreground">x</p>';
    assert.equal(countTextStyles(source), 5);
  });

  it('counts every text colour, family, slant and line height, icons included', () => {
    const source = '<Award className="text-primary" /><p className="text-destructive font-display italic leading-7 font-mono">x</p>';
    assert.equal(countTextStyles(source), 6);
  });

  it('leaves layout classes alone, including text alignment and wrapping, and words that only contain a class name', () => {
    const source = '<div className="flex gap-2 text-center text-balance truncate bg-card border-b">context-sm and font-mediumish</div>';
    assert.equal(countTextStyles(source), 0);
  });

  it('does not count a call to a function that shares a class name', () => {
    assert.equal(countTextStyles('const label = capitalize(noun.one) + capitalize (noun.many);'), 0);
    assert.equal(countTextStyles('<span className="capitalize">{noun.one}</span>'), 1);
  });

  it('skips comment lines, so a comment can name a class', () => {
    assert.equal(countTextStyles('// text-sm is owned by Text\n * font-medium too'), 0);
  });

  it('flags a file over its baseline and one the baseline has never seen as new hand-set styles', () => {
    const { over } = compareWithBaseline({ 'a.tsx': 3, 'b.tsx': 1 }, { 'a.tsx': 2 });
    assert.deepEqual(over, [
      { path: 'a.tsx', count: 3, allowed: 2 },
      { path: 'b.tsx', count: 1, allowed: 0 },
    ]);
  });

  it('flags a file under its baseline, or gone from the scan, so the baseline comes down with the cleanup', () => {
    const { over, under } = compareWithBaseline({ 'a.tsx': 1 }, { 'a.tsx': 2, 'gone.tsx': 4 });
    assert.deepEqual(over, []);
    assert.deepEqual(under, [
      { path: 'a.tsx', count: 1, allowed: 2 },
      { path: 'gone.tsx', count: 0, allowed: 4 },
    ]);
  });

  it('lowers entries on update and drops those at 0 or gone, but never raises an entry or adds a file', () => {
    const counts = { 'cleaned.tsx': 1, 'done.tsx': 0, 'grew.tsx': 9, 'new.tsx': 3 };
    const baseline = { 'cleaned.tsx': 4, 'done.tsx': 2, 'gone.tsx': 5, 'grew.tsx': 6 };
    assert.deepEqual(ratchetBaseline(counts, baseline), { 'cleaned.tsx': 1, 'grew.tsx': 6 });
  });

  it('passes a file that matches its baseline', () => {
    assert.deepEqual(compareWithBaseline({ 'a.tsx': 2 }, { 'a.tsx': 2 }), { over: [], under: [] });
  });
});
