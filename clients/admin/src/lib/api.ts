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
import type { ClientOptions } from '@poolmaster/shared/generated/hey-api';
import { useAdminAuthStore } from '@/stores/admin-auth-store';

export const client = createClient(createConfig<ClientOptions>({
  baseUrl: '/',
}));

client.interceptors.request.use((request: Request) => {
  const token = localStorage.getItem('admin_access_token');
  const adminUser = useAdminAuthStore.getState().adminUser;
  if (token) {
    request.headers.set('Authorization', `Bearer ${token}`);
  }
  if (adminUser?.id) {
    request.headers.set('x-admin-user-id', adminUser.id);
  }
  if (adminUser?.email) {
    request.headers.set('x-admin-user-email', adminUser.email);
  }
  return request;
});

// Re-export all generated SDK functions and types
export * from '@poolmaster/shared/generated/hey-api';
