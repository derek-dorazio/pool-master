import { createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { ClientOptions } from '@poolmaster/shared/generated/hey-api';
import { client } from '@poolmaster/shared/generated/hey-api/client.gen';
import { readCookie } from './cookies';
import { getOrCreateClientTraceId } from './logger';

const resolvedBaseUrl =
  typeof window !== 'undefined' && window.location?.origin !== 'null'
    ? window.location.origin
    : 'http://localhost';

client.setConfig(
  createConfig<ClientOptions>({
    baseUrl: resolvedBaseUrl,
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
