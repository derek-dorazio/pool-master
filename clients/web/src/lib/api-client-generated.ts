/**
 * Generated typed API client — auto-typed from OpenAPI spec.
 *
 * Usage:
 *   import { client, typedData } from '@/lib/api-client-generated';
 *   const result = await client.GET('/api/v1/leagues/');
 *   const data = typedData<LeagueListResponse>(result);
 *
 * Note: Our OpenAPI spec defines responses with `content?: never`, so
 * openapi-fetch types `data` as `never`. At runtime, `data` still contains
 * the parsed JSON body. Use the `typedData` helper to cast safely and
 * throw on error responses in one step.
 */
import createClient from 'openapi-fetch';
import type { paths } from '@poolmaster/shared/generated';

// In browser, use the current origin. In tests/SSR, fall back to localhost.
const resolvedBaseUrl = typeof window !== 'undefined' && window.location?.origin !== 'null'
  ? window.location.origin
  : 'http://localhost';

export const client = createClient<paths>({
  baseUrl: resolvedBaseUrl,
  // Use a lazy reference to globalThis.fetch so that test tools (MSW)
  // that patch fetch after module load are picked up at request time.
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

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

/**
 * Extract typed data from an openapi-fetch result, throwing on error.
 *
 * Because the OpenAPI spec currently declares `content?: never` on all
 * response schemas, TypeScript types `data` as `never`. At runtime,
 * openapi-fetch still parses the JSON body into `data`. This helper
 * checks for errors and casts the runtime value to the expected type.
 */
export function typedData<T>(result: { data?: unknown; error?: unknown; response: Response }): T {
  if (result.error) throw result.error;
  if (!result.response.ok) {
    throw new Error(`Request failed: ${result.response.status}`);
  }
  return result.data as T;
}
