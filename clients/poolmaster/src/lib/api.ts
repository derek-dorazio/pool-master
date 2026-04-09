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

let accessToken: string | null = null;

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

client.interceptors.request.use((request: Request) => {
  if (accessToken) {
    request.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return request;
});

export * from '@poolmaster/shared/generated/hey-api';
