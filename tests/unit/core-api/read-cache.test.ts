import { ReadCache, readCacheTtlMs } from '../../../packages/core-api/src/core/read-cache';

// What forgetting a read does (#1163): a write this container made drops the key at once, so
// the next read computes afresh, even while an older computation is still in flight. Keeping
// a read for its TTL, sharing one in flight and dropping a failed one are covered through the
// contest leaderboard cache, which keeps its boards in a ReadCache.

const T0 = new Date('2026-10-28T20:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('ReadCache.forget', () => {
  it('drops a kept value at once, so the next read within the TTL computes afresh and keeps that', async () => {
    const cache = new ReadCache<string>();
    await cache.get('event-1', at(0), async () => 'before the write');

    cache.forget('event-1');

    await expect(cache.get('event-1', at(1), async () => 'after the write')).resolves.toBe('after the write');
    await expect(cache.get('event-1', at(2), async () => 'a third read')).resolves.toBe('after the write');
  });

  it('stops handing out a computation still in flight from before the write', async () => {
    const cache = new ReadCache<string>();
    let finish: (value: string) => void = () => undefined;
    const before = cache.get('event-1', at(0), () => new Promise<string>((resolve) => { finish = resolve; }));

    cache.forget('event-1');
    const after = cache.get('event-1', at(1), async () => 'after the write');
    finish('before the write');

    await expect(before).resolves.toBe('before the write');
    await expect(after).resolves.toBe('after the write');
    await expect(cache.get('event-1', at(2), async () => 'a third read')).resolves.toBe('after the write');
  });

  it('leaves every other key alone', async () => {
    const cache = new ReadCache<string>();
    await cache.get('event-1', at(0), async () => 'event 1');
    await cache.get('event-2', at(0), async () => 'event 2');

    cache.forget('event-1');

    await expect(cache.get('event-2', at(1), async () => 'event 2 again')).resolves.toBe('event 2');
  });
});

describe('readCacheTtlMs', () => {
  it('reads the variable it is named, 30 seconds when unset, and names it when refusing a value', () => {
    expect(readCacheTtlMs({ EVENT_FIELD_CACHE_TTL_MS: '0' }, 'EVENT_FIELD_CACHE_TTL_MS')).toBe(0);
    expect(readCacheTtlMs({ CONTEST_LEADERBOARD_CACHE_TTL_MS: '0' }, 'EVENT_FIELD_CACHE_TTL_MS')).toBe(30_000);
    expect(() => readCacheTtlMs({ EVENT_FIELD_CACHE_TTL_MS: '-5' }, 'EVENT_FIELD_CACHE_TTL_MS'))
      .toThrow('EVENT_FIELD_CACHE_TTL_MS must be a whole number of milliseconds, 0 or more; got "-5"');
  });
});
