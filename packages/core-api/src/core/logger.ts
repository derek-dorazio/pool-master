import type {
  FastifyBaseLogger,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';
import { readAppEnv } from './config';
import { readVersionInfo } from './version-info';

/** The options-object form of Fastify's `logger` setting (Fastify does not export the pino type). */
type FastifyLoggerSettings = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-csrf-token"]',
  'authorization',
  'cookie',
  'accessToken',
  'refreshToken',
  'password',
  'passwordHash',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  // #847 — the password reset and change bodies. A reset token is as good as the password.
  '*.currentPassword',
  '*.newPassword',
  '*.confirmNewPassword',
  '*.token',
];

/** Query values that are as good as a credential: the email unsubscribe link carries `token`. */
const REDACTED_QUERY_KEYS = new Set(['token']);

/** The URL as logged, with each credential-like query value replaced by the redaction censor. */
export function redactUrlForLog(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return url;
  const query = url
    .slice(queryStart + 1)
    .split('&')
    .map((pair) => {
      const key = pair.split('=', 1)[0];
      return REDACTED_QUERY_KEYS.has(key) ? `${key}=[REDACTED]` : pair;
    })
    .join('&');
  return `${url.slice(0, queryStart)}?${query}`;
}

export interface RequestLogBindings {
  reqId: string;
  sessionId: string | null;
  userId: string | null;
  isRootAdmin: boolean;
  clientTraceId: string | null;
  clientRequestId: string | null;
  ip: string;
  method: string;
  route: string;
}

export type ServiceLogger = Pick<
  FastifyBaseLogger,
  'debug' | 'info' | 'warn' | 'error' | 'fatal'
>;

/** Test suites quieten themselves by setting LOG_LEVEL; production code has no test branch. */
function resolveLogLevel(): string {
  return process.env.LOG_LEVEL ?? 'info';
}

function resolveRoute(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split('?', 1).join('');
}

export function createFastifyLoggerOptions(
  serviceName: string,
): FastifyLoggerSettings {
  return {
    level: resolveLogLevel(),
    base: {
      service: serviceName,
      env: readAppEnv(),
      version: readVersionInfo().service.version,
    },
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    serializers: {
      // Fastify's default request serializer, with the URL's credential query values redacted.
      req(request: FastifyRequest) {
        return {
          method: request.method,
          url: redactUrlForLog(request.url),
          host: request.host,
          remoteAddress: request.ip,
          remotePort: request.socket.remotePort,
        };
      },
    },
    formatters: {
      level(label) {
        return { level: label.toUpperCase() };
      },
    },
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
  };
}

// clientTraceId/clientRequestId join backend log lines to their originating
// browser tab/call (ADR-0005: docs/adr/0005-cross-tier-log-correlation.md).
// The webapp sets these headers on every outbound call, primarily via the
// interceptor in clients/poolmaster/src/lib/api.ts — but that is not the
// only site; see the comment there for the full list. Client-originated
// log entries flow through the same binding via
// packages/core-api/src/modules/client-logs/, tagged data.source: 'client',
// into this same CloudWatch log group.
export function buildRequestLogBindings(request: FastifyRequest): RequestLogBindings {
  const authUser = request.authUser;
  const headers = request.headers;

  return {
    reqId: request.id,
    sessionId: authUser?.sessionId ?? null,
    userId: authUser?.userId ?? null,
    isRootAdmin: authUser?.isRootAdmin === true,
    clientTraceId: headers['x-client-trace-id']?.toString() ?? null,
    clientRequestId: headers['x-client-request-id']?.toString() ?? null,
    ip: request.ip,
    method: request.method,
    route: resolveRoute(request),
  };
}

export function createRequestContextLogger(
  request: FastifyRequest,
): FastifyBaseLogger {
  const bindings = (({ reqId: _reqId, ...rest }: RequestLogBindings) => rest)(
    buildRequestLogBindings(request),
  );
  return request.log.child(bindings);
}
