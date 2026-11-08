import { describe, expect, it } from '@jest/globals';
import { ifNoneMatchHas, leaderboardEtag } from '../../../packages/core-api/src/modules/contests/leaderboard-etag';

describe('leaderboardEtag', () => {
  const computedFrom = new Date('2026-11-08T01:00:00.000Z');

  it('names a stored board by its version and when it began computing', () => {
    expect(leaderboardEtag({ version: 3, computedFrom })).toBe(`"lb-3-${computedFrom.getTime()}"`);
  });

  it('differs for a board dropped and computed again, which starts over at version 1', () => {
    const rebuilt = new Date(computedFrom.getTime() + 1);
    expect(leaderboardEtag({ version: 1, computedFrom: rebuilt })).not.toBe(leaderboardEtag({ version: 1, computedFrom }));
  });
});

describe('ifNoneMatchHas', () => {
  const etag = '"lb-2-1794186000000"';

  it('matches the tag alone, in a list, weak, or as *', () => {
    expect(ifNoneMatchHas(etag, etag)).toBe(true);
    expect(ifNoneMatchHas(`"other", ${etag}`, etag)).toBe(true);
    expect(ifNoneMatchHas(`W/${etag}`, etag)).toBe(true);
    expect(ifNoneMatchHas('*', etag)).toBe(true);
  });

  it('does not match no header or another board\'s tag, so the board is sent', () => {
    expect(ifNoneMatchHas(undefined, etag)).toBe(false);
    expect(ifNoneMatchHas('"lb-1-1794186000000"', etag)).toBe(false);
  });
});
