/**
 * Configured hey-api client for the web app.
 *
 * Creates a dedicated client instance with browser base URL and user auth token.
 * SDK functions are re-exported with this client pre-bound.
 *
 * Usage:
 *   import { client, listLeagues } from '@/lib/api';
 *   const { data } = await listLeagues({ client });
 */
import { createClient, createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { ClientOptions } from '@poolmaster/shared/generated/hey-api/types.gen';

// Resolve base URL: current origin in browser, localhost in tests/SSR
const resolvedBaseUrl = typeof window !== 'undefined' && window.location?.origin !== 'null'
  ? window.location.origin
  : 'http://localhost';

export const client = createClient(createConfig<ClientOptions>({
  baseUrl: resolvedBaseUrl,
}));

client.interceptors.request.use((request) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  return request;
});

// Re-export all generated SDK functions and types
export * from '@poolmaster/shared/generated/hey-api/sdk.gen';
export type * from '@poolmaster/shared/generated/hey-api/types.gen';
