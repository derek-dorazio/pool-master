/**
 * How every sync service calls a provider (league model slice 1c): paced locally to its share of
 * the provider's rate limit, retried by cockatiel, and paused by a circuit breaker during a storm
 * of 429s. A provider's HTTP client makes one attempt per call and says what its failure was; this
 * policy is the only retry layer.
 *
 * - Pacing: each task holds itself to `requestsPerMinute / maxTasks`, the provider's limit shared
 *   evenly by the most tasks that run background work at once. The limit is read for each request
 *   from the provider's settings in memory (its Provider row, #1997), so an edit takes effect without
 *   a restart and no request waits on a database read; the jobs one task runs at once share its one
 *   pace.
 * - Retry: a 429, a 5xx or no answer is tried again, up to three more times. A 429 that names a
 *   Retry-After within the longest wait is honoured; otherwise the wait backs off exponentially,
 *   with jitter, up to that cap.
 * - Breaker: five 429s in a row open the provider's circuit for a minute; calls meanwhile are
 *   refused without reaching the provider.
 *
 * A call the open circuit refuses, a 429 whose Retry-After is longer than the longest wait, and a
 * 429 that is still a 429 when the retries run out end as `ProviderRateLimitedError`: the job's
 * try ends RATE_LIMITED and is queued again for when the provider will answer, without counting
 * toward its attempts.
 */

import {
  BrokenCircuitError,
  ConsecutiveBreaker,
  ExponentialBackoff,
  circuitBreaker,
  halfJitterGenerator,
  handleWhen,
  retry,
  wrap,
  type IBackoffFactory,
  type IRetryBackoffContext,
} from 'cockatiel';
import { JobErrorType } from '@poolmaster/shared/domain';
import type { ClassifiedJobError, DeferredJobError } from '../../background-jobs/job-error-type';

/** What a failed attempt says about trying again. */
export const ProviderFailureKind = {
  /** The provider refused for load: a 429. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** The provider failed or never answered: a 5xx, a timeout, a dropped connection. */
  TRANSIENT: 'TRANSIENT',
  /** Trying again gives the same answer: any other status, or a body that breaks the contract. */
  FINAL: 'FINAL',
} as const;
export type ProviderFailureKind = (typeof ProviderFailureKind)[keyof typeof ProviderFailureKind];

/** An error a provider client throws for one failed attempt, saying what kind of failure it was. */
export interface ProviderCallFailure {
  readonly providerFailure: ProviderFailureKind;
  /** The wait a 429's Retry-After named, in milliseconds; null when it named none. */
  readonly retryAfterMs: number | null;
}

/** Retries after the first attempt. */
export const PROVIDER_CALL_MAX_RETRIES = 3;
/** The first back-off; each later one doubles, with half jitter (between half and all of it). */
export const PROVIDER_CALL_BACKOFF_BASE_MS = 1_000;
/** The longest one call waits before trying again, a Retry-After included. */
export const PROVIDER_CALL_MAX_WAIT_MS = 30_000;
/** 429s in a row that open the provider's circuit. */
export const PROVIDER_BREAKER_CONSECUTIVE_429S = 5;
/** How long an open circuit refuses calls before letting one through to test the provider. */
export const PROVIDER_BREAKER_OPEN_MS = 60_000;

/**
 * The provider refused this call for load, and retrying now would only be refused again: the job
 * is queued again for `deferUntil`, without counting the try toward its attempts.
 */
export class ProviderRateLimitedError extends Error implements ClassifiedJobError, DeferredJobError {
  readonly jobErrorType = JobErrorType.RATE_LIMITED;

  constructor(
    readonly providerId: string,
    readonly deferUntil: Date,
    reason: string,
    options?: { cause?: unknown },
  ) {
    super(`${providerId} is rate limiting PoolMaster (${reason}); try again after ${deferUntil.toISOString()}`, options);
    this.name = 'ProviderRateLimitedError';
  }
}

export interface ProviderCallPolicyOptions {
  /** The provider, for the refusal's message. */
  providerId: string;
  /** The provider plan's limit, shared by every task: a number, or read for each request. */
  requestsPerMinute: number | (() => number);
  /** The most tasks that run background work at once (config), each taking an even share. */
  maxTasks: number;
  /** Clock and wait for the pacing, injectable so it is testable without real time. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function isProviderCallFailure(error: unknown): error is Error & ProviderCallFailure {
  if (!(error instanceof Error)) return false;
  const kind = (error as Partial<ProviderCallFailure>).providerFailure;
  return kind === ProviderFailureKind.RATE_LIMITED || kind === ProviderFailureKind.TRANSIENT || kind === ProviderFailureKind.FINAL;
}

function isRateLimited(error: unknown): error is Error & ProviderCallFailure {
  return isProviderCallFailure(error) && error.providerFailure === ProviderFailureKind.RATE_LIMITED;
}

/** A 429 whose Retry-After is longer than one call may wait: the job waits instead. */
function waitsTooLong(error: ProviderCallFailure): boolean {
  return error.retryAfterMs !== null && error.retryAfterMs > PROVIDER_CALL_MAX_WAIT_MS;
}

/** A 429 within the longest wait, a 5xx, or no answer. */
function isWorthRetrying(error: Error): boolean {
  if (!isProviderCallFailure(error)) return false;
  if (error.providerFailure === ProviderFailureKind.TRANSIENT) return true;
  return error.providerFailure === ProviderFailureKind.RATE_LIMITED && !waitsTooLong(error);
}

/** Honours a 429's Retry-After; otherwise the next step of the exponential back-off. */
function retryAfterBackoff(exponential: IBackoffFactory<unknown>): IBackoffFactory<IRetryBackoffContext<unknown>> {
  return {
    next(context) {
      const step = exponential.next(context);
      const failure = 'error' in context.result ? context.result.error : undefined;
      const retryAfterMs = isRateLimited(failure) ? failure.retryAfterMs : null;
      const following = retryAfterBackoff(step);
      return { duration: retryAfterMs ?? step.duration, next: (later) => following.next(later) };
    },
  };
}

/** Doubling from the base, with half jitter (between half and all of each step), capped at the longest wait. */
const exponentialBackoff = (): IBackoffFactory<unknown> => new ExponentialBackoff({
  initialDelay: PROVIDER_CALL_BACKOFF_BASE_MS,
  maxDelay: PROVIDER_CALL_MAX_WAIT_MS,
  generator: halfJitterGenerator,
});

/** One provider's pacing, retries and breaker. Built once per provider client, so it is shared by every job on the task. */
export class ProviderCallPolicy {
  private readonly requestsPerMinute: () => number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** When the next request may start; requests reserve their slot in call order. */
  private nextSlotAt = 0;
  /** When the circuit last opened, on the same clock cockatiel reads. */
  private openedAt = 0;
  private readonly policy;

  constructor(private readonly options: ProviderCallPolicyOptions) {
    const { requestsPerMinute, maxTasks } = options;
    if (!Number.isInteger(maxTasks) || maxTasks < 1) {
      throw new Error(`The background task pool's maximum task count must be a whole number of at least 1, not ${String(maxTasks)}.`);
    }
    this.requestsPerMinute = typeof requestsPerMinute === 'function' ? requestsPerMinute : () => requestsPerMinute;
    // A bad limit is refused at construction, not at the first request.
    this.intervalOf(this.requestsPerMinute());
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));

    const breaker = circuitBreaker(handleWhen(isRateLimited), {
      halfOpenAfter: PROVIDER_BREAKER_OPEN_MS,
      breaker: new ConsecutiveBreaker(PROVIDER_BREAKER_CONSECUTIVE_429S),
    });
    // The real clock, not the injected `now`: cockatiel decides when the circuit half-opens from
    // Date.now(), so the time a refused job is deferred to must be read from the same clock. The
    // injected clock paces requests only.
    breaker.onBreak(() => { this.openedAt = Date.now(); });
    const retries = retry(handleWhen(isWorthRetrying), {
      maxAttempts: PROVIDER_CALL_MAX_RETRIES,
      backoff: retryAfterBackoff(exponentialBackoff()),
    });
    this.policy = wrap(retries, breaker);
  }

  /** The gap this task keeps between the starts of two requests to the provider. */
  get intervalMs(): number {
    return this.intervalOf(this.requestsPerMinute());
  }

  /** The gap at this limit, shared by the tasks; a limit that is not a whole number of at least 1 is refused. */
  private intervalOf(requestsPerMinute: number): number {
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1) {
      throw new Error(`${this.options.providerId} requestsPerMinute must be a whole number of at least 1, not ${String(requestsPerMinute)}.`);
    }
    return Math.ceil((60_000 * this.options.maxTasks) / requestsPerMinute);
  }

  /** Runs one provider request under the pacing, retries and breaker. `attempt` is tried once each time. */
  async execute<T>(attempt: () => Promise<T>): Promise<T> {
    try {
      return await this.policy.execute(async () => {
        await this.takeSlot();
        return attempt();
      });
    } catch (error) {
      throw this.refusalOf(error) ?? error;
    }
  }

  /** The rate-limited endings, as the error that defers the job; anything else stays as it was. */
  private refusalOf(error: unknown): ProviderRateLimitedError | null {
    const { providerId } = this.options;
    if (error instanceof BrokenCircuitError) {
      return new ProviderRateLimitedError(providerId, new Date(this.openedAt + PROVIDER_BREAKER_OPEN_MS), 'its circuit is open after repeated 429s', { cause: error });
    }
    if (!isRateLimited(error)) return null;
    if (waitsTooLong(error)) {
      return new ProviderRateLimitedError(providerId, new Date(Date.now() + (error.retryAfterMs ?? 0)), 'a 429 asked for a longer wait than one call makes', { cause: error });
    }
    return new ProviderRateLimitedError(
      providerId,
      new Date(Date.now() + (error.retryAfterMs ?? PROVIDER_BREAKER_OPEN_MS)),
      'still 429 after every retry',
      { cause: error },
    );
  }

  /** Waits for the next free slot under this task's share of the limit, then holds it. */
  private async takeSlot(): Promise<void> {
    const now = this.now();
    const startAt = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = startAt + this.intervalMs;
    if (startAt > now) {
      await this.sleep(startAt - now);
    }
  }
}
