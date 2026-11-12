import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countCardCorners } from './check-card-corners.mjs';

describe('check-card-corners (#1591)', () => {
  it('counts each rounded-2xl, rounded-3xl and rounded-4xl class, with side and breakpoint prefixes', () => {
    assert.equal(countCardCorners('<div className="rounded-2xl border p-4" />'), 1);
    assert.equal(countCardCorners('<div className="rounded-3xl sm:rounded-4xl" />'), 2);
    assert.equal(countCardCorners('<div className="rounded-t-3xl md:rounded-br-2xl" />'), 2);
  });

  it('leaves the shared 8px corner and the small radii alone', () => {
    assert.equal(countCardCorners('<div className="rounded-lg rounded-xl rounded-full rounded-md" />'), 0);
  });

  it('skips comment lines, so a note about the old look does not count', () => {
    assert.equal(countCardCorners('// was rounded-3xl\n * rounded-2xl box\n<div className="rounded-lg" />'), 0);
  });
});
