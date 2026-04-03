/**
 * Configured hey-api client for the admin app.
 *
 * Creates a dedicated client instance with admin auth token.
 * SDK functions are re-exported with this client pre-bound.
 *
 * Usage:
 *   import { client, adminListTenants } from '@/lib/api';
 *   const { data } = await adminListTenants({ client });
 */
import { createClient, createConfig } from '@poolmaster/shared/generated/hey-api/client';
import type { ClientOptions } from '@poolmaster/shared/generated/hey-api/types.gen';

export const client = createClient(createConfig<ClientOptions>({
  baseUrl: '/',
}));

client.interceptors.request.use((request: Request) => {
  const token = localStorage.getItem('admin_access_token');
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  return request;
});

// Re-export all generated SDK functions and types
export * from '@poolmaster/shared/generated/hey-api/sdk.gen';
export type * from '@poolmaster/shared/generated/hey-api/types.gen';
