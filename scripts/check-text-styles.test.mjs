import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareWithBaseline, countTextStyles, isCheckedSource } from './check-text-styles.mjs';

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

  it('leaves layout and other colour classes alone, and words that only contain a class name', () => {
    const source = '<div className="flex gap-2 text-destructive bg-card border-b">context-sm and font-mediumish</div>';
    assert.equal(countTextStyles(source), 0);
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

  it('passes a file that matches its baseline', () => {
    assert.deepEqual(compareWithBaseline({ 'a.tsx': 2 }, { 'a.tsx': 2 }), { over: [], under: [] });
  });
});
