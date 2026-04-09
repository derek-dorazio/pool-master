import { createClient, createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { ClientOptions } from '@poolmaster/shared/generated/hey-api';

const resolvedBaseUrl =
  typeof window !== 'undefined' && window.location?.origin !== 'null'
    ? window.location.origin
    : 'http://localhost';

export const client = createClient(
  createConfig<ClientOptions>({
    baseUrl: resolvedBaseUrl,
  }),
);

client.interceptors.request.use((request: Request) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  return request;
});

export * from '@poolmaster/shared/generated/hey-api';
