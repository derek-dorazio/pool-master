/**
 * Generated typed API client for admin app — auto-typed from OpenAPI spec.
 */
import createClient from 'openapi-fetch';
import type { paths } from '@poolmaster/shared/generated';

export const client = createClient<paths>({ baseUrl: '/' });

client.use({
  async onRequest({ request }) {
    const token = localStorage.getItem('admin_access_token');
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
});
