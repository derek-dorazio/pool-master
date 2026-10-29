/**
 * Clears the public reads CloudFront keeps (#1181) after an admin save, so a visitor sees the
 * change without waiting out the hour `PUBLIC_CACHE_CONTROL` gives them.
 *
 * Saves close together share one invalidation: the paths asked for go out in one
 * CreateInvalidation once `batchMs` passes with no further save, or `maxWaitMs` after the first
 * one, so a data load of many writes over minutes costs a few, not hundreds, and CloudFront's
 * limit of 15 wildcard invalidations in progress is not reached. One refused for that limit
 * (TooManyInvalidationsInProgress) is sent once more after `retryMs`. Each one is
 * sent again `settleMs` later, once every API task has caught up with the save (each keeps a
 * public read for `PUBLIC_READ_CACHE_TTL_MS` and reloads settings every 30 seconds); otherwise a
 * refill served by a task that had not caught up would keep the old answer for another hour.
 *
 * The save has already succeeded when this runs, so a failed invalidation does not fail it: it
 * is logged as an error, and the stale copy lasts at most the hour.
 */
import { randomUUID } from 'node:crypto';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import type { FastifyBaseLogger } from 'fastify';
import type { PublicReadPath } from './public-cache';

type InvalidatorLogger = Pick<FastifyBaseLogger, 'info' | 'error'>;

export interface CdnInvalidator {
  /** Clears these public reads at the CDN, soon; returns at once. */
  invalidate(paths: readonly PublicReadPath[]): void;
}

/** The one call this needs from the AWS client, so tests can stand in for it. */
export interface CloudFrontClientLike {
  send(command: CreateInvalidationCommand): Promise<unknown>;
}

/** How long with no further save before the gathered paths are sent. */
export const CDN_INVALIDATION_BATCH_MS = 5_000;

/** The longest a save waits while others keep arriving, as in a data load. */
export const CDN_INVALIDATION_MAX_WAIT_MS = 60_000;

/** How long before an invalidation CloudFront refused for too many in progress is sent again. */
export const CDN_INVALIDATION_RETRY_MS = 60_000;

/** CloudFront's error for a distribution with too many invalidations in progress. */
const TOO_MANY_IN_PROGRESS = 'TooManyInvalidationsInProgress';

/** When the invalidation is sent again: after the public read cache and the settings refresh. */
export const CDN_INVALIDATION_SETTLE_MS = 35_000;

export interface CloudFrontInvalidatorOptions {
  distributionId: string;
  client: CloudFrontClientLike;
  logger: InvalidatorLogger;
  batchMs?: number;
  maxWaitMs?: number;
  retryMs?: number;
  settleMs?: number;
}

export class CloudFrontInvalidator implements CdnInvalidator {
  private readonly pending = new Set<PublicReadPath>();
  private flushTimer: NodeJS.Timeout | null = null;
  /** When the first of the pending saves asked, which bounds how long they wait. */
  private firstAskedAt: number | null = null;
  private readonly batchMs: number;
  private readonly maxWaitMs: number;
  private readonly retryMs: number;
  private readonly settleMs: number;

  constructor(private readonly options: CloudFrontInvalidatorOptions) {
    this.batchMs = options.batchMs ?? CDN_INVALIDATION_BATCH_MS;
    this.maxWaitMs = options.maxWaitMs ?? CDN_INVALIDATION_MAX_WAIT_MS;
    this.retryMs = options.retryMs ?? CDN_INVALIDATION_RETRY_MS;
    this.settleMs = options.settleMs ?? CDN_INVALIDATION_SETTLE_MS;
  }

  invalidate(paths: readonly PublicReadPath[]): void {
    for (const path of paths) this.pending.add(path);
    if (this.pending.size === 0) return;
    const now = Date.now();
    this.firstAskedAt ??= now;
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    const wait = Math.min(this.batchMs, this.firstAskedAt + this.maxWaitMs - now);
    this.flushTimer = setTimeout(() => this.flush(), Math.max(0, wait));
    this.flushTimer.unref();
  }

  private flush(): void {
    this.flushTimer = null;
    this.firstAskedAt = null;
    const paths = [...this.pending].sort();
    this.pending.clear();
    void this.send(paths, 'first', true);
    setTimeout(() => void this.send(paths, 'settled', true), this.settleMs).unref();
  }

  private async send(paths: string[], round: 'first' | 'settled', mayRetry: boolean): Promise<void> {
    const { distributionId, client, logger } = this.options;
    try {
      await client.send(new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: {
          CallerReference: randomUUID(),
          Paths: { Quantity: paths.length, Items: paths },
        },
      }));
      logger.info({ action: 'cdn.invalidate.sent', data: { paths, round } }, 'Invalidated public reads at CloudFront');
    } catch (err) {
      const tooMany = err instanceof Error && err.name === TOO_MANY_IN_PROGRESS;
      if (tooMany && mayRetry) {
        logger.info({ action: 'cdn.invalidate.retrying', data: { paths, round, retryMs: this.retryMs } }, 'CloudFront has too many invalidations in progress; sending this one again later');
        setTimeout(() => void this.send(paths, round, false), this.retryMs).unref();
        return;
      }
      logger.error({
        action: 'cdn.invalidate.failed',
        data: { paths, round, error: err instanceof Error ? err.message : String(err) },
      }, 'CloudFront invalidation failed; the public reads stay cached up to an hour');
    }
  }
}

/** No CDN in front of this API (a local run, a test): there is nothing to clear. */
export class NoCdnInvalidator implements CdnInvalidator {
  invalidate(): void {
    // Nothing caches these reads but the browser, which keeps them 5 minutes.
  }
}

/**
 * CloudFront's invalidator when `CLOUDFRONT_DISTRIBUTION_ID` names the distribution in front of
 * this API (Terraform sets it on core-api's task), else none.
 */
export function createCdnInvalidator(env: NodeJS.ProcessEnv, logger: InvalidatorLogger): CdnInvalidator {
  const distributionId = env['CLOUDFRONT_DISTRIBUTION_ID']?.trim();
  if (!distributionId) {
    logger.info({ action: 'cdn.invalidate.off' }, 'CLOUDFRONT_DISTRIBUTION_ID is unset; admin saves invalidate no CDN');
    return new NoCdnInvalidator();
  }
  // CloudFront is a global service; its API is served from us-east-1.
  return new CloudFrontInvalidator({ distributionId, client: new CloudFrontClient({ region: 'us-east-1' }), logger });
}
