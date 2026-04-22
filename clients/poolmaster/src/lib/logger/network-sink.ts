import { API_ROUTES } from '@poolmaster/shared/api-routes';
import type { ClientLogBatch, ClientLogEntry } from '@poolmaster/shared/dto';
import type { LogLevel, LogMeta, LogPayload, LogSink } from './types';

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_MAX_BUFFER_SIZE = 200;

type TransportRequest = {
  body: ClientLogBatch;
  useBeacon: boolean;
};

type TransportResult = {
  ok: boolean;
  retryable: boolean;
};

type NetworkSinkOptions = {
  endpoint?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  transport?: (request: TransportRequest) => Promise<TransportResult>;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  now?: () => number;
  documentLike?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  navigatorLike?: Pick<Navigator, 'sendBeacon' | 'userAgent'>;
};

type BufferedClientLogEntry = ClientLogEntry & {
  clientTraceId: string;
  webappVersion: string;
  userAgent: string;
};

function randomRequestId(): string {
  return crypto.randomUUID();
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

function createDefaultTransport(options: {
  endpoint: string;
  navigatorLike?: Pick<Navigator, 'sendBeacon'>;
}): (request: TransportRequest) => Promise<TransportResult> {
  return async ({ body, useBeacon }) => {
    const serializedBody = JSON.stringify(body);

    if (useBeacon && options.navigatorLike?.sendBeacon) {
      const blob = new Blob([serializedBody], { type: 'application/json' });
      const ok = options.navigatorLike.sendBeacon(options.endpoint, blob);
      return { ok, retryable: false };
    }

    try {
      const response = await fetch(options.endpoint, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Trace-Id': body.clientTraceId,
          'X-Client-Request-Id': randomRequestId(),
        },
        body: serializedBody,
      });

      return {
        ok: response.ok,
        retryable: isRetryableStatus(response.status),
      };
    } catch {
      return {
        ok: false,
        retryable: true,
      };
    }
  };
}

function toBufferedEntry(
  level: LogLevel,
  payload: LogPayload,
  msg: string | undefined,
  meta: LogMeta,
): BufferedClientLogEntry {
  return {
    level,
    action: payload.action,
    ...(msg ? { msg } : {}),
    ts: meta.ts,
    ...(meta.route ? { route: meta.route } : {}),
    sessionId: meta.sessionId ?? null,
    userId: meta.userId ?? null,
    clientRequestId: null,
    ...(payload.data ? { data: payload.data } : {}),
    ...(payload.err !== undefined ? { err: payload.err } : {}),
    clientTraceId: meta.clientTraceId,
    webappVersion: meta.webappVersion,
    userAgent: meta.userAgent,
  };
}

function delay(
  ms: number,
  setTimeoutFn: typeof setTimeout,
): Promise<void> {
  return new Promise((resolve) => {
    setTimeoutFn(resolve, ms);
  });
}

export function createNetworkSink(options: NetworkSinkOptions = {}): LogSink {
  const endpoint = options.endpoint ?? API_ROUTES.observability.clientLogs;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const transport = options.transport ?? createDefaultTransport({
    endpoint,
    navigatorLike: options.navigatorLike ?? (typeof navigator !== 'undefined' ? navigator : undefined),
  });
  const documentLike = options.documentLike ?? (typeof document !== 'undefined' ? document : undefined);

  const buffer: BufferedClientLogEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushInFlight = false;

  const scheduleFlush = () => {
    if (flushTimer || buffer.length === 0) {
      return;
    }

    flushTimer = setTimeoutFn(() => {
      flushTimer = null;
      void flush(false);
    }, flushIntervalMs);
  };

  const clearFlushTimer = () => {
    if (!flushTimer) {
      return;
    }

    clearTimeoutFn(flushTimer);
    flushTimer = null;
  };

  const buildBatch = (entries: BufferedClientLogEntry[]): ClientLogBatch => {
    const [first] = entries;

    return {
      schemaVersion: 1,
      clientTraceId: first.clientTraceId,
      webappVersion: first.webappVersion,
      userAgent: first.userAgent,
      entries: entries.map((entry) => ({
        level: entry.level,
        action: entry.action,
        ...(entry.msg ? { msg: entry.msg } : {}),
        ts: entry.ts,
        ...(entry.route ? { route: entry.route } : {}),
        sessionId: entry.sessionId ?? null,
        userId: entry.userId ?? null,
        clientRequestId: entry.clientRequestId ?? null,
        ...(entry.data ? { data: entry.data } : {}),
        ...(entry.err !== undefined ? { err: entry.err } : {}),
      })),
    };
  };

  const flush = async (useBeacon: boolean) => {
    if (flushInFlight || buffer.length === 0) {
      return;
    }

    flushInFlight = true;
    clearFlushTimer();

    const entries = buffer.splice(0, batchSize);
    const batch = buildBatch(entries);

    const attempt = async (attemptNumber: number): Promise<boolean> => {
      const result = await transport({
        body: batch,
        useBeacon: useBeacon && attemptNumber === 1,
      });

      if (result.ok) {
        return true;
      }

      if (!result.retryable || attemptNumber >= 2) {
        return false;
      }

      await delay(1_000, setTimeoutFn);
      return attempt(attemptNumber + 1);
    };

    const success = await attempt(1);
    if (!success) {
      console.error('PoolMaster client log transport failed');
    }

    flushInFlight = false;

    if (buffer.length > 0) {
      if (buffer.length >= batchSize) {
        void flush(false);
      } else {
        scheduleFlush();
      }
    }
  };

  if (documentLike) {
    documentLike.addEventListener('visibilitychange', () => {
      if (documentLike.visibilityState === 'hidden' && buffer.length > 0) {
        void flush(true);
      }
    });
  }

  return {
    write(level, payload, msg, meta) {
      buffer.push(toBufferedEntry(level, payload, msg, meta));

      while (buffer.length > maxBufferSize) {
        buffer.shift();
      }

      if (level === 'error' || level === 'fatal' || buffer.length >= batchSize) {
        void flush(false);
        return;
      }

      scheduleFlush();
    },
  };
}
