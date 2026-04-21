import type {
  FastifyBaseLogger,
  FastifyRequest,
  FastifyServerOptions,
} from 'fastify';

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
  ip: string | null;
  method: string;
  route: string;
}

function resolveServiceVersion(): string | undefined {
  return process.env.RELEASE_VERSION
    ?? process.env.APP_VERSION
    ?? process.env.GIT_SHA;
}

function resolveEnvironment(): string {
  return process.env.APP_ENV
    ?? process.env.NODE_ENV
    ?? 'development';
}

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
  const version = resolveServiceVersion();

  return {
    level: resolveLogLevel(),
    base: {
      service: serviceName,
      env: resolveEnvironment(),
      ...(version ? { version } : {}),
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

export function buildRequestLogBindings(request: FastifyRequest): RequestLogBindings {
  const authUser = request.authUser;
  const rootAdminUser = request.rootAdminContext?.rootAdminUser;

  return {
    reqId: request.id,
    sessionId: null,
    userId: authUser?.userId ?? rootAdminUser?.id ?? null,
    isRootAdmin: authUser?.isRootAdmin === true || rootAdminUser?.isRootAdmin === true,
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
