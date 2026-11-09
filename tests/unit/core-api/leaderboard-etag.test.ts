import { describe, expect, it } from '@jest/globals';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ifNoneMatchHas, leaderboardEtag, sendLeaderboard } from '../../../packages/core-api/src/modules/contests/leaderboard-etag';

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

describe('sendLeaderboard', () => {
  const computedFrom = new Date('2026-11-08T01:00:00.000Z');
  const read = { version: 2, computedFrom, board: { rows: ['eagles'] } };

  function reply() {
    const sent: unknown[] = [];
    const calls = { header: new Map<string, string>(), code: 200, sent };
    const fake = {
      header: (name: string, value: string) => { calls.header.set(name, value); return fake; },
      code: (status: number) => { calls.code = status; return fake; },
      send: (body?: unknown) => { sent.push(body); return fake; },
    };
    return { fake, calls };
  }

  it('answers 304 with no body when the reader holds this board, and the mapped board with its tag otherwise', () => {
    const etag = leaderboardEtag(read);
    const held = reply();
    const fresh = reply();

    sendLeaderboard({ headers: { 'if-none-match': etag } } as unknown as FastifyRequest, held.fake as unknown as FastifyReply, read, (each) => each.board);
    sendLeaderboard({ headers: {} } as unknown as FastifyRequest, fresh.fake as unknown as FastifyReply, read, (each) => each.board);

    expect([held.calls.code, held.calls.sent, held.calls.header.get('ETag')]).toEqual([304, [undefined], etag]);
    expect([fresh.calls.code, fresh.calls.sent, fresh.calls.header.get('ETag')]).toEqual([200, [{ rows: ['eagles'] }], etag]);
  });
});
