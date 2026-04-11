import { createClient, createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { ClientOptions } from '@poolmaster/shared/generated/hey-api';
import { readCookie } from './cookies';

const resolvedBaseUrl =
  typeof window !== 'undefined' && window.location?.origin !== 'null'
    ? window.location.origin
    : 'http://localhost';

export const client = createClient(
  createConfig<ClientOptions>({
    baseUrl: resolvedBaseUrl,
    credentials: 'include',
  }),
);

client.interceptors.request.use((request: Request) => {
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
