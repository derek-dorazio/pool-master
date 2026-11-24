import { expect } from '@jest/globals';
import { JobErrorType } from '@poolmaster/shared/domain';
import {
  PROVIDER_BREAKER_CONSECUTIVE_429S,
  PROVIDER_BREAKER_OPEN_MS,
  PROVIDER_CALL_MAX_RETRIES,
  PROVIDER_CALL_MAX_WAIT_MS,
  ProviderCallPolicy,
  ProviderFailureKind,
  ProviderRateLimitedError,
  type ProviderCallFailure,
  type ProviderCallPolicyOptions,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-call-policy';
import { jobDeferredUntilOf, jobErrorTypeOf } from '../../../packages/core-api/src/modules/background-jobs/job-error-type';

const START = new Date('2026-11-24T12:00:00.000Z').getTime();

/** One failed attempt, as a provider client throws it. */
class AttemptFailure extends Error implements ProviderCallFailure {
  constructor(readonly providerFailure: ProviderFailureKind, readonly retryAfterMs: number | null = null) {
    super(`attempt failed: ${providerFailure}`);
  }
}
const rateLimited = (retryAfterMs: number | null = null) => new AttemptFailure(ProviderFailureKind.RATE_LIMITED, retryAfterMs);
const transient = () => new AttemptFailure(ProviderFailureKind.TRANSIENT);
const final = () => new AttemptFailure(ProviderFailureKind.FINAL);

/**
 * An attempt that answers each of `replies` in turn, an Error being thrown, and records when
 * (on the fake clock) each try started.
 */
function scripted(replies: Array<string | Error>) {
  const startedAt: number[] = [];
  const queue = [...replies];
  const attempt = jest.fn(() => {
    startedAt.push(Date.now());
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error('no more replies'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { attempt, startedAt, gaps: () => startedAt.slice(1).map((at, index) => at - startedAt[index]) };
}

/** Runs the fake clock until `promise` settles, and answers how it settled and when. */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown; at: number }> {
  let outcome: { value?: T; error?: unknown; at: number } | undefined;
  promise.then((value) => { outcome = { value, at: Date.now() }; }, (error: unknown) => { outcome = { error, at: Date.now() }; });
  for (let step = 0; step < 1_000 && outcome === undefined; step += 1) {
    await jest.advanceTimersByTimeAsync(1_000);
  }
  if (outcome === undefined) throw new Error('the call never settled');
  return outcome;
}

function policy(options: Partial<ProviderCallPolicyOptions> = {}) {
  return new ProviderCallPolicy({ providerId: 'TEST_PROVIDER', requestsPerMinute: 6_000, maxTasks: 1, ...options });
}

describe('provider call policy (league model 1c)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: START });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('pacing', () => {
    /** A clock that only moves when the policy waits, so pacing is read exactly. */
    function virtualClock() {
      let now = START;
      return { now: () => now, sleep: (ms: number) => { now += ms; return Promise.resolve(); } };
    }

    it('spaces one task\'s requests to the provider\'s whole limit when one task runs background work', async () => {
      const clock = virtualClock();
      const calls = policy({ requestsPerMinute: 60, maxTasks: 1, ...clock });
      const at: number[] = [];

      for (let call = 0; call < 3; call += 1) await calls.execute(() => { at.push(clock.now()); return Promise.resolve('ok'); });

      expect(calls.intervalMs).toBe(1_000);
      expect(at.map((time) => time - START)).toEqual([0, 1_000, 2_000]);
    });

    it('holds each task to an even share of the limit, so three tasks at 60 a minute each start a request every 3 seconds', async () => {
      const clock = virtualClock();
      const calls = policy({ requestsPerMinute: 60, maxTasks: 3, ...clock });
      const at: number[] = [];

      await calls.execute(() => { at.push(clock.now()); return Promise.resolve('ok'); });
      await calls.execute(() => { at.push(clock.now()); return Promise.resolve('ok'); });

      expect(calls.intervalMs).toBe(3_000);
      expect(at[1] - at[0]).toBe(3_000);
    });

    it('reads a limit given as a function for each request, so a Providers page edit paces the next one', async () => {
      const clock = virtualClock();
      let limit = 60;
      const calls = policy({ requestsPerMinute: () => limit, ...clock });
      const at: number[] = [];

      await calls.execute(() => { at.push(clock.now()); return Promise.resolve('ok'); });
      await calls.execute(() => { at.push(clock.now()); return Promise.resolve('ok'); });
      limit = 6;
      await calls.execute(() => { at.push(clock.now()); return Promise.resolve('ok'); });
      await calls.execute(() => { at.push(clock.now()); return Promise.resolve('ok'); });

      // The third's slot was reserved at the old pace; the gap after it is the new one.
      expect(at.map((time) => time - START)).toEqual([0, 1_000, 2_000, 12_000]);
      expect(calls.intervalMs).toBe(10_000);
    });

    it('refuses a request once a limit read for each request is no longer a whole number of at least one, sending nothing', async () => {
      let limit = 60;
      const calls = policy({ requestsPerMinute: () => limit, ...virtualClock() });
      limit = 0;
      const attempt = jest.fn(() => Promise.resolve('ok'));

      await expect(calls.execute(attempt)).rejects.toThrow('TEST_PROVIDER requestsPerMinute must be a whole number of at least 1, not 0.');
      expect(attempt).not.toHaveBeenCalled();
    });

    it('gives calls made together consecutive slots, so jobs sharing a task share its one pace', async () => {
      const waits: number[] = [];
      const calls = policy({ requestsPerMinute: 60, now: () => START, sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });

      await Promise.all([1, 2, 3].map(() => calls.execute(() => Promise.resolve('ok'))));

      expect(waits).toEqual([1_000, 2_000]);
    });

    it.each([0, 2.5, -1])('refuses a requestsPerMinute of %s', (requestsPerMinute) => {
      expect(() => policy({ requestsPerMinute })).toThrow(`TEST_PROVIDER requestsPerMinute must be a whole number of at least 1, not ${String(requestsPerMinute)}.`);
    });

    it.each([0, 1.5])('refuses a task pool maximum of %s', (maxTasks) => {
      expect(() => policy({ maxTasks })).toThrow('maximum task count must be a whole number of at least 1');
    });

    it('waits on real time when no clock is given', async () => {
      const calls = policy({ requestsPerMinute: 60 });
      const { attempt, gaps } = scripted(['a', 'b']);

      await settle(calls.execute(attempt));
      await settle(calls.execute(attempt));

      expect(gaps()).toEqual([1_000]);
    });
  });

  describe('retries', () => {
    it('answers the first attempt that succeeds after a 5xx, backing off with jitter between half and all of 1, then 2 seconds', async () => {
      const { attempt, gaps } = scripted([transient(), transient(), 'ok']);

      const outcome = await settle(policy().execute(attempt));

      expect(outcome.value).toBe('ok');
      const [first, second] = gaps();
      expect(first).toBeGreaterThanOrEqual(500);
      expect(first).toBeLessThanOrEqual(1_000);
      expect(second).toBeGreaterThanOrEqual(1_000);
      expect(second).toBeLessThanOrEqual(2_000);
    });

    it('waits the Retry-After a 429 names before trying again', async () => {
      const { attempt, gaps } = scripted([rateLimited(7_000), 'ok']);

      const outcome = await settle(policy().execute(attempt));

      expect(outcome.value).toBe('ok');
      expect(gaps()).toEqual([7_000]);
    });

    it('throws the last failure of a call whose provider kept failing, once three retries have run out, so it stays a provider error', async () => {
      const last = transient();
      const { attempt } = scripted([transient(), transient(), transient(), last]);

      const outcome = await settle(policy().execute(attempt));

      expect(outcome.error).toBe(last);
      expect(attempt).toHaveBeenCalledTimes(PROVIDER_CALL_MAX_RETRIES + 1);
    });

    it('never retries a failure that would answer the same, such as a 401', async () => {
      const refusal = final();
      const { attempt } = scripted([refusal]);

      const outcome = await settle(policy().execute(attempt));

      expect(outcome.error).toBe(refusal);
      expect(attempt).toHaveBeenCalledTimes(1);
    });

    it('never retries an error that does not say what kind of failure it is', async () => {
      const bug = new TypeError('undefined is not a function');
      const { attempt } = scripted([bug]);

      expect((await settle(policy().execute(attempt))).error).toBe(bug);
      expect(attempt).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate-limited endings', () => {
    it('ends a call still 429 after every retry as rate limited, deferring the job by its last Retry-After without counting the try', async () => {
      const { attempt } = scripted([rateLimited(2_000), rateLimited(2_000), rateLimited(2_000), rateLimited(20_000)]);

      const { error, at } = await settle(policy().execute(attempt));

      expect(error).toBeInstanceOf(ProviderRateLimitedError);
      const refusal = error as ProviderRateLimitedError;
      expect(refusal.message).toContain('still 429 after every retry');
      expect(refusal.deferUntil.getTime()).toBe(at + 20_000);
      expect(jobErrorTypeOf(refusal)).toBe(JobErrorType.RATE_LIMITED);
      expect(jobDeferredUntilOf(refusal)).toEqual(refusal.deferUntil);
    });

    it('defers by the breaker\'s pause a call still 429 after every retry when the provider named no Retry-After', async () => {
      const { attempt } = scripted([rateLimited(), rateLimited(), rateLimited(), rateLimited()]);

      const { error, at } = await settle(policy().execute(attempt));

      expect((error as ProviderRateLimitedError).deferUntil.getTime()).toBe(at + PROVIDER_BREAKER_OPEN_MS);
    });

    it('ends a 429 asking for a longer wait than one call makes at once, deferring the job until then', async () => {
      const longWait = PROVIDER_CALL_MAX_WAIT_MS + 1_000;
      const { attempt } = scripted([rateLimited(longWait)]);

      const { error } = await settle(policy().execute(attempt));

      expect(attempt).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(ProviderRateLimitedError);
      expect((error as ProviderRateLimitedError).deferUntil.getTime()).toBe(START + longWait);
      expect((error as ProviderRateLimitedError).message).toContain('a longer wait than one call makes');
    });

    it('opens the provider\'s circuit after five 429s in a row and refuses calls without reaching it until the pause ends', async () => {
      const calls = policy();
      const first = scripted([rateLimited(), rateLimited(), rateLimited(), rateLimited()]);
      await settle(calls.execute(first.attempt));
      const second = scripted([rateLimited()]);
      const { error: opening } = await settle(calls.execute(second.attempt));
      // The fifth 429 opens the circuit; the retry after it is refused without reaching the provider.
      const openedAt = second.startedAt[0];
      expect(second.attempt).toHaveBeenCalledTimes(1);
      expect(PROVIDER_BREAKER_CONSECUTIVE_429S).toBe(5);

      const refused = scripted(['never sent']);
      const { error } = await settle(calls.execute(refused.attempt));

      expect(opening).toBeInstanceOf(ProviderRateLimitedError);
      expect((opening as ProviderRateLimitedError).deferUntil.getTime()).toBe(openedAt + PROVIDER_BREAKER_OPEN_MS);
      expect(refused.attempt).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(ProviderRateLimitedError);
      expect((error as ProviderRateLimitedError).message).toContain('its circuit is open');
      expect((error as ProviderRateLimitedError).deferUntil.getTime()).toBe(openedAt + PROVIDER_BREAKER_OPEN_MS);

      // Once the pause has passed, one call is let through to test the provider, and an answer closes the circuit.
      jest.setSystemTime(openedAt + PROVIDER_BREAKER_OPEN_MS);
      const after = scripted(['ok', 'ok']);
      expect((await settle(calls.execute(after.attempt))).value).toBe('ok');
      expect((await settle(calls.execute(after.attempt))).value).toBe('ok');
    });

    it('keeps the circuit closed through 5xx failures, which are no sign of a rate limit', async () => {
      const calls = policy();
      for (let call = 0; call < 2; call += 1) {
        await settle(calls.execute(scripted([transient(), transient(), transient(), transient()]).attempt));
      }

      const next = scripted(['ok']);
      expect((await settle(calls.execute(next.attempt))).value).toBe('ok');
    });
  });
  describe('telling the rate-limit finding how calls end', () => {
    function observed() {
      const told: string[] = [];
      return { told, rateLimits: { refused: () => { told.push('refused'); }, answered: () => { told.push('answered'); } } };
    }

    it('tells of each answered call, a retried one included, once', async () => {
      const { told, rateLimits } = observed();
      const calls = policy({ rateLimits });

      await settle(calls.execute(scripted(['ok']).attempt));
      await settle(calls.execute(scripted([rateLimited(), 'ok']).attempt));

      expect(told).toEqual(['answered', 'answered']);
    });

    it('tells of a call that ended rate limited, whether its retries ran out or the open circuit refused it', async () => {
      const { told, rateLimits } = observed();
      const calls = policy({ rateLimits });

      await settle(calls.execute(scripted([rateLimited(), rateLimited(), rateLimited(), rateLimited()]).attempt));
      await settle(calls.execute(scripted([rateLimited(), rateLimited(), rateLimited(), rateLimited()]).attempt));
      const refused = await settle(calls.execute(scripted(['ok']).attempt));

      expect(refused.error).toBeInstanceOf(ProviderRateLimitedError);
      expect(told).toEqual(['refused', 'refused', 'refused']);
    });

    it('tells nothing of a call that failed for another reason, which says nothing of the rate limit', async () => {
      const { told, rateLimits } = observed();
      const calls = policy({ rateLimits });

      await settle(calls.execute(scripted([final()]).attempt));
      await settle(calls.execute(scripted([transient(), transient(), transient(), transient()]).attempt));

      expect(told).toEqual([]);
    });
  });
});
