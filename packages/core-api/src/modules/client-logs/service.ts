import type { FastifyBaseLogger } from 'fastify';
import type { ClientLogBatch, ClientLogLevel } from '@poolmaster/shared/dto';

const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;
const DEFAULT_MAX_BATCH_BYTES = 64 * 1024;

export class ClientLogBatchTooLargeError extends Error {
  readonly code = 'CLIENT_LOG_BATCH_TOO_LARGE';
  readonly statusCode = 413;

  constructor(message = 'Client log batch is too large') {
    super(message);
    this.name = 'ClientLogBatchTooLargeError';
  }
}

export class ClientLogRateLimitError extends Error {
  readonly code = 'CLIENT_LOG_RATE_LIMITED';
  readonly statusCode = 429;

  constructor(message = 'Client log rate limit exceeded') {
    super(message);
    this.name = 'ClientLogRateLimitError';
  }
}

type ClientLogEmitter = Pick<
  FastifyBaseLogger,
  'debug' | 'info' | 'warn' | 'error' | 'fatal'
>;

type ClientLogServiceOptions = {
  logger?: FastifyBaseLogger;
  now?: () => number;
  rateLimitPerMinute?: number;
  maxBatchBytes?: number;
};

export class ClientLogService {
  private readonly logger?: FastifyBaseLogger;
  private readonly now: () => number;
  private readonly rateLimitPerMinute: number;
  private readonly maxBatchBytes: number;
  private readonly requestWindows = new Map<string, number[]>();

  constructor(options: ClientLogServiceOptions = {}) {
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
    this.rateLimitPerMinute = options.rateLimitPerMinute
      ?? Number(process.env.CLIENT_LOGS_RATE_LIMIT_PER_MIN ?? DEFAULT_RATE_LIMIT_PER_MINUTE);
    this.maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES;
  }

  ingestBatch(params: {
    batch: ClientLogBatch;
    ip: string | null;
    requestLogger: ClientLogEmitter;
    /**
     * Session and user identity for the whole batch, read by the handler from the
     * verified JWT on the ingesting request (#206). Never taken from the batch body:
     * a client-supplied value would let any caller attribute log lines to any
     * session or user. Null for an anonymous caller.
     */
    sessionId: string | null;
    userId: string | null;
  }): void {
    this.logger?.debug({
      action: 'clientLogs.ingest.start',
      data: {
        clientTraceId: params.batch.clientTraceId,
        entryCount: params.batch.entries.length,
        ip: params.ip,
      },
    }, 'Processing client log batch');

    this.assertBatchWithinLimits(params.batch);
    this.assertRateLimit(params.ip);

    // Re-emit each client-originated entry through the request-scoped
    // logger, tagged data.source: 'client', into the same core-api
    // CloudWatch log group as backend logs — not a separate frontend log
    // group. See ADR-0005 (docs/adr/0005-cross-tier-log-correlation.md) for
    // why one shared group and why clientTraceId/clientRequestId are the
    // join keys.
    for (const entry of params.batch.entries) {
      const payload = {
        action: entry.action,
        ...(entry.err !== undefined ? { err: entry.err } : {}),
        data: {
          source: 'client',
          clientTraceId: params.batch.clientTraceId,
          clientRequestId: entry.clientRequestId ?? null,
          clientRoute: entry.route ?? null,
          clientTs: entry.ts,
          clientSessionId: params.sessionId,
          clientUserId: params.userId,
          webappVersion: params.batch.webappVersion,
          userAgent: params.batch.userAgent,
          ...(entry.data ?? {}),
        },
      };
      params.requestLogger[entry.level](payload, entry.msg ?? 'Client log entry');
    }

    this.logger?.info({
      action: 'clientLogs.ingest.success',
      data: {
        clientTraceId: params.batch.clientTraceId,
        entryCount: params.batch.entries.length,
        ip: params.ip,
      },
    }, 'Processed client log batch');
  }

  private assertBatchWithinLimits(batch: ClientLogBatch): void {
    const batchBytes = Buffer.byteLength(JSON.stringify(batch), 'utf8');

    if (batch.entries.length > 200 || batchBytes > this.maxBatchBytes) {
      this.logger?.warn({
        action: 'clientLogs.ingest.tooLarge',
        data: {
          clientTraceId: batch.clientTraceId,
          entryCount: batch.entries.length,
          batchBytes,
          maxBatchBytes: this.maxBatchBytes,
        },
      }, 'Rejected oversized client log batch');
      throw new ClientLogBatchTooLargeError();
    }
  }

  private assertRateLimit(ip: string | null): void {
    if (!ip) {
      return;
    }

    const now = this.now();
    const windowStart = now - 60_000;
    const existing = this.requestWindows.get(ip) ?? [];
    const pruned = existing.filter((timestamp) => timestamp >= windowStart);

    if (pruned.length >= this.rateLimitPerMinute) {
      this.requestWindows.set(ip, pruned);
      this.logger?.warn({
        action: 'clientLogs.ingest.rateLimited',
        data: {
          ip,
          requestCount: pruned.length,
          rateLimitPerMinute: this.rateLimitPerMinute,
        },
      }, 'Rejected client log batch due to rate limiting');
      throw new ClientLogRateLimitError();
    }

    pruned.push(now);
    this.requestWindows.set(ip, pruned);
  }
}

export function isClientLogLevel(value: string): value is ClientLogLevel {
  return ['debug', 'info', 'warn', 'error', 'fatal'].includes(value);
}
