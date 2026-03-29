/**
 * RateLimiter — prevents notification storms with per-user, per-channel limits.
 *
 * Uses in-memory sliding window counters. For production at scale,
 * swap to Redis-backed counters.
 */

export interface RateLimitConfig {
  pushPerHour: number;
  emailPerDay: number;
  smsPerDay: number;

  // Per-event-type collapse windows
  collapseWindows: Record<string, { maxPerHour: number; windowMinutes: number }>;

  // Dedup window — don't send same notification twice in this window
  dedupWindowSeconds: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  pushPerHour: 20,
  emailPerDay: 10,
  smsPerDay: 5,
  collapseWindows: {
    'scoring.position_change': { maxPerHour: 3, windowMinutes: 15 },
    'scoring.overtaken': { maxPerHour: 2, windowMinutes: 30 },
    'draft.pick_made': { maxPerHour: 30, windowMinutes: 5 },
  },
  dedupWindowSeconds: 300,
};

interface UsageEntry {
  timestamp: number;
  eventType: string;
  channel: string;
}

export interface RateLimiter {
  check(userId: string, channel: string, eventType: string): Promise<boolean>;
  record(userId: string, channel: string, eventType: string): Promise<void>;
  reset(userId: string): Promise<void>;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly usage = new Map<string, UsageEntry[]>();
  private readonly config: RateLimitConfig;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_RATE_LIMITS, ...config };
  }

  async check(userId: string, channel: string, eventType: string): Promise<boolean> {
    const entries = this.getEntries(userId);
    const now = Date.now();

    // Channel-level rate limits
    if (channel === 'PUSH') {
      const pushInLastHour = entries.filter(
        (e) => e.channel === 'PUSH' && now - e.timestamp < 3600_000,
      ).length;
      if (pushInLastHour >= this.config.pushPerHour) return false;
    }

    if (channel === 'EMAIL') {
      const emailToday = entries.filter(
        (e) => e.channel === 'EMAIL' && now - e.timestamp < 86400_000,
      ).length;
      if (emailToday >= this.config.emailPerDay) return false;
    }

    if (channel === 'SMS') {
      const smsToday = entries.filter(
        (e) => e.channel === 'SMS' && now - e.timestamp < 86400_000,
      ).length;
      if (smsToday >= this.config.smsPerDay) return false;
    }

    // Event-type collapse window
    const collapse = this.config.collapseWindows[eventType];
    if (collapse) {
      const windowMs = collapse.windowMinutes * 60_000;
      const inWindow = entries.filter(
        (e) => e.eventType === eventType && e.channel === channel && now - e.timestamp < windowMs,
      ).length;
      if (inWindow >= collapse.maxPerHour) return false;
    }

    // Dedup — exact same event type + channel within dedup window
    const dedupMs = this.config.dedupWindowSeconds * 1000;
    const isDuplicate = entries.some(
      (e) => e.eventType === eventType && e.channel === channel && now - e.timestamp < dedupMs,
    );
    if (isDuplicate) return false;

    return true;
  }

  async record(userId: string, channel: string, eventType: string): Promise<void> {
    const entries = this.getEntries(userId);
    entries.push({ timestamp: Date.now(), eventType, channel });

    // Prune old entries (older than 24h)
    const cutoff = Date.now() - 86400_000;
    const pruned = entries.filter((e) => e.timestamp > cutoff);
    this.usage.set(userId, pruned);
  }

  async reset(userId: string): Promise<void> {
    this.usage.delete(userId);
  }

  private getEntries(userId: string): UsageEntry[] {
    if (!this.usage.has(userId)) {
      this.usage.set(userId, []);
    }
    return this.usage.get(userId)!;
  }
}
