/**
 * Hits per key per sliding window, held in memory in this process.
 *
 * **Not a fleet-wide ceiling.** Each core-api task keeps its own windows and a deploy empties
 * them, so the real limit a key sees is the number times the running tasks. The callers that use
 * it (client-log ingest, the password reset routes) say why that is good enough for them.
 */
export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Counts one hit for `key` and answers whether it is allowed. A refused hit is not counted, so
   * a caller over the limit gets back in as soon as the oldest hit leaves the window.
   */
  hit(key: string): { allowed: boolean; count: number } {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const recent = (this.windows.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

    if (recent.length >= this.limit) {
      this.windows.set(key, recent);
      return { allowed: false, count: recent.length };
    }

    recent.push(now);
    this.windows.set(key, recent);
    this.forgetIdleKeys(windowStart);
    return { allowed: true, count: recent.length };
  }

  /** Drops keys with no hit inside the window, so addresses seen once do not pile up forever. */
  private forgetIdleKeys(windowStart: number): void {
    if (this.windows.size < IDLE_SWEEP_THRESHOLD) return;
    for (const [key, timestamps] of this.windows) {
      if ((timestamps.at(-1) ?? 0) <= windowStart) this.windows.delete(key);
    }
  }
}

const IDLE_SWEEP_THRESHOLD = 1_000;
