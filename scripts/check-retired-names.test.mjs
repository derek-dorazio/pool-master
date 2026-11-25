import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareWithBaseline, countUses, isCountedSource, ratchetBaseline, readBaseline } from './check-retired-names.mjs';

describe('check-retired-names', () => {
  it('counts production source in the API, shared code and the web app, but not tests or generated clients', () => {
    assert.equal(isCountedSource('packages/core-api/src/modules/events/service.ts'), true);
    assert.equal(isCountedSource('packages/shared/domain/sports/registry.ts'), true);
    assert.equal(isCountedSource('clients/poolmaster/src/features/contests/contest-header.tsx'), true);
    assert.equal(isCountedSource('clients/poolmaster/src/features/contests/contest-header.test.tsx'), false);
    assert.equal(isCountedSource('clients/poolmaster/src/test/fixtures.ts'), false);
    assert.equal(isCountedSource('packages/shared/generated/hey-api/types.gen.ts'), false);
    assert.equal(isCountedSource('tests/support/event-edition.ts'), false);
  });

  it('counts whole-word uses only, so a longer name that contains a retired one is not counted', () => {
    assert.equal(countUses('roundLabel(1); x.roundLabel; eventRoundLabel(2); roundLabels', 'roundLabel'), 2);
    assert.equal(countUses('const $roundLabel = 1;', 'roundLabel'), 0);
  });

  it('matches a name with regex characters literally, so a name never acts as a pattern', () => {
    assert.equal(countUses('use $store and a.b, not aXb', '$store'), 1);
    assert.equal(countUses('a.b and aXb', 'a.b'), 1);
  });

  it('reports a name used more than its baseline as a new use, and one used less as an entry to lower', () => {
    const { over, under } = compareWithBaseline({ a: 3, b: 1 }, { a: 2, b: 2 }, { a: '#1', b: '#2' });
    assert.deepEqual(over, [{ name: 'a', count: 3, allowed: 2 }]);
    assert.deepEqual(under, [{ name: 'b', count: 1, allowed: 2 }]);
  });

  it('refuses a retired name that has no owner ticket', () => {
    assert.deepEqual(compareWithBaseline({ a: 1 }, { a: 1 }, {}).unowned, ['a']);
  });

  it('only lowers entries when updating, and drops a name that reaches no uses', () => {
    assert.deepEqual(ratchetBaseline({ a: 5, b: 0, c: 1 }, { a: 2, b: 3, c: 4 }), { a: 2, c: 1 });
  });

  it('keeps the comment and the owners apart from the counts', () => {
    const { counts, owners } = readBaseline(JSON.stringify({ $comment: 'x', $owners: { a: '#1' }, a: 2 }));
    assert.deepEqual(counts, { a: 2 });
    assert.deepEqual(owners, { a: '#1' });
  });
});
