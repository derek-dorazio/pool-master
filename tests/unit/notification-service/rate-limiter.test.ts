import { InMemoryRateLimiter } from '../../../packages/core-api/src/modules/notifications/core/rate-limiter';

describe('InMemoryRateLimiter', () => {
  let limiter: InMemoryRateLimiter;

  beforeEach(() => {
    limiter = new InMemoryRateLimiter({
      pushPerHour: 3,
      emailPerDay: 2,
      smsPerDay: 1,
      collapseWindows: {
        'scoring.position_change': { maxPerHour: 2, windowMinutes: 15 },
      },
      dedupWindowSeconds: 60,
    });
  });

  it('allows notifications within rate limits', async () => {
    const allowed = await limiter.check('user1', 'PUSH', 'draft.on_the_clock');
    expect(allowed).toBe(true);
  });

  it('blocks push after exceeding per-hour limit', async () => {
    for (let i = 0; i < 3; i++) {
      await limiter.record('user1', 'PUSH', `event.${i}`);
    }
    const allowed = await limiter.check('user1', 'PUSH', 'event.new');
    expect(allowed).toBe(false);
  });

  it('blocks email after exceeding per-day limit', async () => {
    await limiter.record('user1', 'EMAIL', 'event.1');
    await limiter.record('user1', 'EMAIL', 'event.2');
    const allowed = await limiter.check('user1', 'EMAIL', 'event.3');
    expect(allowed).toBe(false);
  });

  it('blocks duplicate events within dedup window', async () => {
    await limiter.record('user1', 'PUSH', 'scoring.taken_the_lead');
    const allowed = await limiter.check('user1', 'PUSH', 'scoring.taken_the_lead');
    expect(allowed).toBe(false);
  });

  it('allows different event types on same channel', async () => {
    await limiter.record('user1', 'PUSH', 'draft.completed');
    const allowed = await limiter.check('user1', 'PUSH', 'scoring.taken_the_lead');
    expect(allowed).toBe(true);
  });

  it('enforces collapse window for grouped events', async () => {
    await limiter.record('user1', 'PUSH', 'scoring.position_change');
    await limiter.record('user1', 'PUSH', 'scoring.position_change');
    const allowed = await limiter.check('user1', 'PUSH', 'scoring.position_change');
    expect(allowed).toBe(false);
  });

  it('allows IN_APP without limits (in-app handled separately)', async () => {
    // In-app is always delivered — limiter only governs push/email/sms
    for (let i = 0; i < 100; i++) {
      await limiter.record('user1', 'IN_APP', 'event.spam');
    }
    const allowed = await limiter.check('user1', 'IN_APP', 'event.more');
    expect(allowed).toBe(true);
  });

  it('resets usage for a user', async () => {
    await limiter.record('user1', 'PUSH', 'event.1');
    await limiter.record('user1', 'PUSH', 'event.2');
    await limiter.record('user1', 'PUSH', 'event.3');

    await limiter.reset('user1');

    const allowed = await limiter.check('user1', 'PUSH', 'event.new');
    expect(allowed).toBe(true);
  });

  it('isolates limits between users', async () => {
    for (let i = 0; i < 3; i++) {
      await limiter.record('user1', 'PUSH', `event.${i}`);
    }
    const user1Allowed = await limiter.check('user1', 'PUSH', 'event.new');
    const user2Allowed = await limiter.check('user2', 'PUSH', 'event.new');

    expect(user1Allowed).toBe(false);
    expect(user2Allowed).toBe(true);
  });
});
