/**
 * Generated typed API client — auto-typed from OpenAPI spec.
 *
 * Usage:
 *   import { client } from '@/lib/api-client-generated';
 *   const { data, error } = await client.GET('/api/v1/leagues');
 *   // data is fully typed from the OpenAPI spec
 *   // path is validated at compile time
 */
import createClient from 'openapi-fetch';
import type { paths } from '@poolmaster/shared/generated';

export const client = createClient<paths>({ baseUrl: '/' });

// Add auth header to every request
client.use({
  async onRequest({ request }) {
    const token = localStorage.getItem('access_token');
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
});
