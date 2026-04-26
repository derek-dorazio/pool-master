import { createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { ClientOptions } from '@poolmaster/shared/generated/hey-api';
import { client } from '@poolmaster/shared/generated/hey-api/client.gen';
import { readCookie } from './cookies';
import { getOrCreateClientTraceId } from './logger';

function resolveBaseUrl() {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (envBaseUrl) {
    return envBaseUrl;
  }

  if (typeof window !== 'undefined' && window.location?.origin !== 'null') {
    return window.location.origin;
  }

  return 'http://localhost';
}

client.setConfig(
  createConfig<ClientOptions>({
    baseUrl: resolveBaseUrl(),
    credentials: 'include',
  }),
);

client.interceptors.request.use((request: Request) => {
  request.headers.set('X-Client-Trace-Id', getOrCreateClientTraceId());
  request.headers.set('X-Client-Request-Id', crypto.randomUUID());

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
