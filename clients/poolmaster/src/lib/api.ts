import { createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { ClientOptions } from '@poolmaster/shared/generated/hey-api';
import { client } from '@poolmaster/shared/generated/hey-api/client.gen';
import { readCookie } from './cookies';
import { getOrCreateClientTraceId } from './logger';

const AUTH_REFRESHABLE_ERROR_CODES = new Set([
  'AUTH_SESSION_REQUIRED',
  'AUTH_ACCESS_TOKEN_INVALID',
  'ROOT_ADMIN_SESSION_REQUIRED',
  'ROOT_ADMIN_SESSION_INVALID',
]);

export function resolveBaseUrl() {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (envBaseUrl) {
    return envBaseUrl.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && window.location?.origin !== 'null') {
    return window.location.origin;
  }

  return 'http://localhost';
}

function isStateChangingMethod(method: string) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

function isAuthLifecycleRequest(request: Request) {
  const pathname = new URL(request.url).pathname;
  return pathname === '/api/v1/auth/login'
    || pathname === '/api/v1/auth/logout'
    || pathname === '/api/v1/auth/refresh'
    || pathname === '/api/v1/auth/register';
}

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Correlation-only fallback for environments without Web Crypto; not a security identifier.
  return `pm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readErrorCode(response: Response): Promise<string | null> {
  if (response.status !== 401) {
    return null;
  }

  const body = await response.clone().json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return null;
  }

  const envelope = body as { error?: { code?: unknown }; code?: unknown };
  if (typeof envelope.error?.code === 'string') {
    return envelope.error.code;
  }
  if (typeof envelope.code === 'string') {
    return envelope.code;
  }
  return null;
}

function withRetryHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.set('X-Client-Request-Id', createClientRequestId());
  headers.set('X-PoolMaster-Auth-Retry', '1');

  if (isStateChangingMethod(request.method)) {
    const csrfToken = readCookie('poolmaster_csrf');
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  return new Request(request, {
    headers,
  });
}

async function refreshAccessSession(request: Request, fetchImpl: typeof fetch) {
  const refreshUrl = new URL('/api/v1/auth/refresh', request.url);
  const headers = new Headers({
    'X-Client-Trace-Id': getOrCreateClientTraceId(),
    'X-Client-Request-Id': createClientRequestId(),
  });

  const response = await fetchImpl(refreshUrl, {
    credentials: 'include',
    headers,
    method: 'POST',
  });

  return response.ok;
}

async function poolmasterFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const retryRequest = request.clone();
  const fetchImpl = globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(request);

  if (isAuthLifecycleRequest(request)) {
    return response;
  }

  const errorCode = await readErrorCode(response);
  if (!errorCode || !AUTH_REFRESHABLE_ERROR_CODES.has(errorCode)) {
    return response;
  }

  const refreshed = await refreshAccessSession(request, fetchImpl).catch(() => false);
  if (!refreshed) {
    return response;
  }

  return fetchImpl(withRetryHeaders(retryRequest));
}

client.setConfig(
  createConfig<ClientOptions>({
    baseUrl: resolveBaseUrl(),
    credentials: 'include',
    fetch: poolmasterFetch,
  }),
);

client.interceptors.request.use((request: Request) => {
  request.headers.set('X-Client-Trace-Id', getOrCreateClientTraceId());
  request.headers.set('X-Client-Request-Id', createClientRequestId());

  if (
    typeof document !== 'undefined'
    && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())
  ) {
    const csrfToken = readCookie('poolmaster_csrf');
    if (csrfToken) {
      request.headers.set('X-CSRF-Token', csrfToken);
    }
  }
  return request;
});

export * from '@poolmaster/shared/generated/hey-api/index';
