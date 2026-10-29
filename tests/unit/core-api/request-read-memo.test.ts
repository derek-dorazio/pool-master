import Fastify from 'fastify';
import type { PrismaClient } from '@prisma/client';
import {
  forgetAllReads,
  forgetReads,
  forgettingReads,
  memoizedRead,
  memoizedReadMany,
  outsideReadMemo,
  ReadMemoKey,
  runWithReadMemo,
} from '../../../packages/core-api/src/core/request-read-memo';
import { requestReadMemo } from '../../../packages/core-api/src/plugins/request-read-memo';

// The request read memo (#1176): within one request a point read is made once and shared, a
// write forgets what it touches, and nothing is remembered outside a request or inside a
// transaction.

/** Stands in for the root Prisma client, which is the only one with `$transaction`. */
const ROOT = { $transaction: jest.fn() } as unknown as PrismaClient;
/** Stands in for an interactive transaction's client, which has none. */
const TX = {} as unknown as PrismaClient;

function counter() {
  let reads = 0;
  return jest.fn(() => {
    reads += 1;
    return Promise.resolve({ name: `read ${String(reads)}` });
  });
}

describe('request read memo', () => {
  it('makes a read once per scope and hands every later asker the same result', async () => {
    const load = counter();

    const [first, second] = await runWithReadMemo(async () => [
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load),
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('keeps each key and each scope apart', async () => {
    const load = counter();

    await runWithReadMemo(async () => {
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
      await memoizedRead(ROOT, `${ReadMemoKey.league}b`, load);
    });
    await runWithReadMemo(() => memoizedRead(ROOT, `${ReadMemoKey.league}a`, load));

    expect(load).toHaveBeenCalledTimes(3);
  });

  it('reads every time outside a scope, as a scheduler sweep or script does', async () => {
    const load = counter();

    await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
    await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never remembers a read through a transaction\'s client, so a transaction sees its own rows', async () => {
    const load = counter();

    await runWithReadMemo(async () => {
      await memoizedRead(TX, `${ReadMemoKey.league}a`, load);
      await memoizedRead(TX, `${ReadMemoKey.league}a`, load);
    });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reads again after a write forgets the reads it touches, and only those', async () => {
    const leagueLoad = counter();
    const membershipLoad = counter();

    await runWithReadMemo(async () => {
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, leagueLoad);
      await memoizedRead(ROOT, `${ReadMemoKey.leagueMembership}a:u`, membershipLoad);
      await forgettingReads(ReadMemoKey.league, () => Promise.resolve('written'));
      const after = await memoizedRead(ROOT, `${ReadMemoKey.league}a`, leagueLoad);
      await memoizedRead(ROOT, `${ReadMemoKey.leagueMembership}a:u`, membershipLoad);
      expect(after).toEqual({ name: 'read 2' });
    });

    expect(leagueLoad).toHaveBeenCalledTimes(2);
    expect(membershipLoad).toHaveBeenCalledTimes(1);
  });

  it('forgets after a write that fails too, since it may have changed the row', async () => {
    const load = counter();

    await runWithReadMemo(async () => {
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
      await expect(forgettingReads(ReadMemoKey.league, () => Promise.reject(new Error('conflict')))).rejects.toThrow('conflict');
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
    });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not remember a read that failed, so the next asker tries again', async () => {
    const load = jest.fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ name: 'second try' });

    const result = await runWithReadMemo(async () => {
      await expect(memoizedRead(ROOT, `${ReadMemoKey.league}a`, load)).rejects.toThrow('connection reset');
      return memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
    });

    expect(result).toEqual({ name: 'second try' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('forgets every prefix a write names, and only those', async () => {
    const load = counter();

    await runWithReadMemo(async () => {
      await memoizedRead(ROOT, `${ReadMemoKey.contest}c`, load);
      await memoizedRead(ROOT, `${ReadMemoKey.contestConfiguration}c`, load);
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
      await forgettingReads([ReadMemoKey.contest, ReadMemoKey.contestConfiguration], () => Promise.resolve('deleted'));
      await memoizedRead(ROOT, `${ReadMemoKey.contest}c`, load);
      await memoizedRead(ROOT, `${ReadMemoKey.contestConfiguration}c`, load);
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
    });

    expect(load).toHaveBeenCalledTimes(5);
  });

  it('remembers nothing for work run outside the memo from inside a request', async () => {
    const load = counter();

    await runWithReadMemo(async () => {
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
      await outsideReadMemo(async () => {
        await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
        await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
      });
    });

    expect(load).toHaveBeenCalledTimes(3);
  });

  it('ignores forgetReads outside a scope', () => {
    expect(() => forgetReads(ReadMemoKey.league)).not.toThrow();
  });
});

describe('request read memo, many rows at once', () => {
  function rowsLoader() {
    return jest.fn((ids: readonly string[]) => Promise.resolve(ids.filter((id) => id !== 'gone').map((id) => ({ id, name: `event ${id}` }))));
  }

  it('loads only the rows not read yet, in one call, and answers later point reads from them', async () => {
    const loadMany = rowsLoader();
    const loadOne = counter();

    const result = await runWithReadMemo(async () => {
      await memoizedRead(ROOT, `${ReadMemoKey.sportEvent}a`, () => Promise.resolve({ id: 'a', name: 'event a' }));
      const rows = await memoizedReadMany(ROOT, ReadMemoKey.sportEvent, ['a', 'b', 'c'], loadMany);
      const b = await memoizedRead(ROOT, `${ReadMemoKey.sportEvent}b`, loadOne);
      return { rows, b };
    });

    expect(loadMany).toHaveBeenCalledTimes(1);
    expect(loadMany).toHaveBeenCalledWith(['b', 'c']);
    expect(loadOne).not.toHaveBeenCalled();
    expect(result.rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(result.b).toBe(result.rows[1]);
  });

  it('leaves out a missing row and remembers it as missing, and returns a repeated id once', async () => {
    const loadMany = rowsLoader();

    const [first, again] = await runWithReadMemo(async () => [
      await memoizedReadMany(ROOT, ReadMemoKey.sportEvent, ['a', 'gone', 'a'], loadMany),
      await memoizedRead(ROOT, `${ReadMemoKey.sportEvent}gone`, counter()),
    ]);

    expect(first).toEqual([{ id: 'a', name: 'event a' }]);
    expect(again).toBeNull();
    expect(loadMany).toHaveBeenCalledWith(['a', 'gone']);
  });

  it('reads every time outside a scope or through a transaction\'s client', async () => {
    const loadMany = rowsLoader();

    await memoizedReadMany(ROOT, ReadMemoKey.sportEvent, ['a'], loadMany);
    await runWithReadMemo(async () => {
      await memoizedReadMany(TX, ReadMemoKey.sportEvent, ['a'], loadMany);
      await memoizedReadMany(TX, ReadMemoKey.sportEvent, ['a'], loadMany);
    });

    expect(loadMany).toHaveBeenCalledTimes(3);
  });

  it('does not remember rows whose load failed, so the next asker loads them again', async () => {
    const loadMany = jest.fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce([{ id: 'a', name: 'event a' }]);

    const rows = await runWithReadMemo(async () => {
      await expect(memoizedReadMany(ROOT, ReadMemoKey.sportEvent, ['a'], loadMany)).rejects.toThrow('connection reset');
      return memoizedReadMany(ROOT, ReadMemoKey.sportEvent, ['a'], loadMany);
    });

    expect(rows).toEqual([{ id: 'a', name: 'event a' }]);
  });

  it('forgets every kind of read at once for a write whose reach spans kinds', async () => {
    const load = counter();

    await runWithReadMemo(async () => {
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
      await memoizedRead(ROOT, `${ReadMemoKey.contest}c`, load);
      forgetAllReads();
      await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
      await memoizedRead(ROOT, `${ReadMemoKey.contest}c`, load);
    });

    expect(load).toHaveBeenCalledTimes(4);
  });
});

describe('request read memo plugin', () => {
  it('shares a read between a request\'s gate and its handler, and gives the next request its own', async () => {
    const load = counter();
    const app = Fastify();
    await app.register(requestReadMemo);
    app.get('/league', {
      preHandler: async () => {
        await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
      },
    }, async () => memoizedRead(ROOT, `${ReadMemoKey.league}a`, load));

    const first = await app.inject({ method: 'GET', url: '/league' });
    expect(load).toHaveBeenCalledTimes(1);
    const second = await app.inject({ method: 'GET', url: '/league' });

    expect(first.json()).toEqual({ name: 'read 1' });
    expect(second.json()).toEqual({ name: 'read 2' });
    expect(load).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('keeps the request\'s memo after its JSON body is parsed', async () => {
    const load = counter();
    const app = Fastify();
    await app.register(requestReadMemo);
    app.post('/league', {
      preHandler: async () => {
        await memoizedRead(ROOT, `${ReadMemoKey.league}a`, load);
      },
    }, async () => memoizedRead(ROOT, `${ReadMemoKey.league}a`, load));

    const response = await app.inject({ method: 'POST', url: '/league', payload: { name: 'Renamed' } });

    expect(response.json()).toEqual({ name: 'read 1' });
    expect(load).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
