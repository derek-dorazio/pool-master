import type {
  FastifyBaseLogger,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';
import { readAppEnv, readServiceVersion } from './config';

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
];

export interface RequestLogBindings {
  reqId: string;
  sessionId: string | null;
  userId: string | null;
  isRootAdmin: boolean;
  clientTraceId: string | null;
  clientRequestId: string | null;
  ip: string | null;
  method: string;
  route: string;
}

export type ServiceLogger = Pick<
  FastifyBaseLogger,
  'debug' | 'info' | 'warn' | 'error' | 'fatal'
>;

function resolveLogLevel(): string {
  return process.env.LOG_LEVEL
    ?? (process.env.NODE_ENV === 'test' ? 'warn' : 'info');
}

function resolveRoute(request: FastifyRequest): string {
  return request.routeOptions?.url
    ?? request.url.split('?')[0]
    ?? request.url;
}

export function createFastifyLoggerOptions(
  serviceName: string,
): FastifyServerOptions['logger'] {
  return {
    level: resolveLogLevel(),
    base: {
      service: serviceName,
      env: readAppEnv(),
      version: readServiceVersion(),
    },
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
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
  const rootAdminUser = request.rootAdminContext?.rootAdminUser;
  const headers = request.headers ?? {};

  return {
    reqId: request.id,
    sessionId: authUser?.sessionId ?? null,
    userId: authUser?.userId ?? rootAdminUser?.id ?? null,
    isRootAdmin: authUser?.isRootAdmin === true || rootAdminUser?.isRootAdmin === true,
    clientTraceId: headers['x-client-trace-id']?.toString() ?? null,
    clientRequestId: headers['x-client-request-id']?.toString() ?? null,
    ip: request.ip ?? null,
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
