/**
 * Clears the public reads CloudFront keeps (#1181) after an admin save, so a visitor sees the
 * change without waiting out the hour `PUBLIC_CACHE_CONTROL` gives them.
 *
 * Saves close together share one invalidation: the paths asked for within `batchMs` go out in
 * one CreateInvalidation, so a data load of many writes costs a few, not hundreds. Each one is
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

/** How long saves are gathered into one invalidation. */
export const CDN_INVALIDATION_BATCH_MS = 5_000;

/** When the invalidation is sent again: after the public read cache and the settings refresh. */
export const CDN_INVALIDATION_SETTLE_MS = 35_000;

export interface CloudFrontInvalidatorOptions {
  distributionId: string;
  client: CloudFrontClientLike;
  logger: InvalidatorLogger;
  batchMs?: number;
  settleMs?: number;
}

export class CloudFrontInvalidator implements CdnInvalidator {
  private readonly pending = new Set<PublicReadPath>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly batchMs: number;
  private readonly settleMs: number;

  constructor(private readonly options: CloudFrontInvalidatorOptions) {
    this.batchMs = options.batchMs ?? CDN_INVALIDATION_BATCH_MS;
    this.settleMs = options.settleMs ?? CDN_INVALIDATION_SETTLE_MS;
  }

  invalidate(paths: readonly PublicReadPath[]): void {
    for (const path of paths) this.pending.add(path);
    if (this.pending.size === 0 || this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => this.flush(), this.batchMs);
    this.flushTimer.unref();
  }

  private flush(): void {
    this.flushTimer = null;
    const paths = [...this.pending].sort();
    this.pending.clear();
    void this.send(paths, 'first');
    setTimeout(() => void this.send(paths, 'settled'), this.settleMs).unref();
  }

  private async send(paths: string[], round: 'first' | 'settled'): Promise<void> {
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
