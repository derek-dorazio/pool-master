/**
 * A read this container computed lately, kept for a TTL so the viewers polling it share one
 * computation (#1162, #1163). Per container: each API task keeps its own, so a viewer can see a
 * value up to one TTL older than the latest write another task made.
 *
 * A computation in flight is shared too: a second caller asking while the first one's value is
 * being computed waits for it rather than starting another. A computation that fails is not
 * kept, so the next caller asks again. `forget` drops a key at once, for a write this container
 * made: a computation in flight for it is no longer handed out, so the next caller reads afresh.
 * `clear` drops every key, for a write whose reach spans keys.
 */

/** How long a read is kept, unless the environment sets another. */
export const READ_CACHE_TTL_MS = 30_000;

/**
 * The TTL the environment variable `name` sets, in milliseconds, else 30 seconds. 0 keeps no
 * value past its computation, as the functional API lane runs, where a test reads right after
 * the write it checks. Anything but a whole number of 0 or more refuses to start.
 */
export function readCacheTtlMs(env: NodeJS.ProcessEnv, name: string): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return READ_CACHE_TTL_MS;
  const ttlMs = Number(raw);
  if (!Number.isInteger(ttlMs) || ttlMs < 0) {
    throw new Error(`${name} must be a whole number of milliseconds, 0 or more; got "${raw}"`);
  }
  return ttlMs;
}

interface CachedRead<T> {
  expiresAt: number;
  value: Promise<T>;
}

export class ReadCache<T> {
  private readonly reads = new Map<string, CachedRead<T>>();

  constructor(private readonly ttlMs: number = READ_CACHE_TTL_MS) {}

  /** The value for `key` computed within the TTL as of `now`, else `compute`'s, kept. */
  get(key: string, now: Date, compute: () => Promise<T>): Promise<T> {
    const at = now.getTime();
    const cached = this.reads.get(key);
    if (cached && cached.expiresAt > at) {
      return cached.value;
    }
    this.dropExpired(at);
    const value = compute();
    const entry = { expiresAt: at + this.ttlMs, value };
    this.reads.set(key, entry);
    value.catch(() => {
      if (this.reads.get(key) === entry) this.reads.delete(key);
    });
    return value;
  }

  /** Drops `key`, so the next read of it computes afresh. */
  forget(key: string): void {
    this.reads.delete(key);
  }

  /** Drops every key, for a write that touches values under many keys at once. */
  clear(): void {
    this.reads.clear();
  }

  /** Forgets every value past its TTL, so the cache holds only the keys read lately. */
  private dropExpired(at: number): void {
    for (const [key, cached] of this.reads) {
      if (cached.expiresAt <= at) this.reads.delete(key);
    }
  }
}
