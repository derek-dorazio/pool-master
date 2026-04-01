/**
 * API smoke test setup — verifies the API is running before tests execute.
 *
 * Set BASE_URL env var to test against a remote environment:
 *   BASE_URL=https://qa.ultimateofficepoolmanager.com npm run test:smoke:api
 *
 * Default: http://localhost:3000 (local dev)
 */

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function checkHealth(): Promise<void> {
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error(`Health check returned ${response.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `API is not running at ${BASE_URL}/health.\n` +
      `  Error: ${message}\n` +
      `  For local: run "npm run dev:start" first.\n` +
      `  For remote: set BASE_URL=https://qa.ultimateofficepoolmanager.com`,
    );
  }
}

/**
 * Enhanced fetch wrapper for smoke tests.
 * Logs detailed error information when the response is not the expected status.
 * This helps agents diagnose failures without needing access to the running server.
 */
export async function smokeFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, options);

  // Log non-2xx responses for debugging
  if (!res.ok) {
    const clone = res.clone();
    let bodyText: string;
    try {
      bodyText = await clone.text();
      // Truncate HTML responses
      if (bodyText.startsWith('<!') || bodyText.startsWith('<html')) {
        bodyText = `[HTML response - ${bodyText.length} bytes] ${bodyText.slice(0, 200)}...`;
      }
      if (bodyText.length > 1000) {
        bodyText = bodyText.slice(0, 1000) + '...[truncated]';
      }
    } catch {
      bodyText = '[unable to read response body]';
    }

    const method = options?.method ?? 'GET';
    console.error(
      `\n🔴 SMOKE TEST HTTP ERROR:\n` +
      `  ${method} ${url}\n` +
      `  Status: ${res.status} ${res.statusText}\n` +
      `  Response body: ${bodyText}\n`,
    );
  }

  return res;
}

/**
 * Assert a response status and log detailed error context on failure.
 * Use instead of bare `expect(res.status).toBe(expected)` for better diagnostics.
 */
export async function expectStatus(
  res: Response,
  expected: number | number[],
  context?: string,
): Promise<void> {
  const expectedArr = Array.isArray(expected) ? expected : [expected];

  if (!expectedArr.includes(res.status)) {
    const clone = res.clone();
    let bodyText: string;
    try {
      bodyText = await clone.text();
      if (bodyText.startsWith('<!') || bodyText.startsWith('<html')) {
        bodyText = `[HTML response - ${bodyText.length} bytes]`;
      }
      if (bodyText.length > 500) {
        bodyText = bodyText.slice(0, 500) + '...[truncated]';
      }
    } catch {
      bodyText = '[unable to read body]';
    }

    const msg = [
      `Expected status ${expectedArr.join(' or ')}, got ${res.status}`,
      context ? `Context: ${context}` : '',
      `URL: ${res.url}`,
      `Response: ${bodyText}`,
    ].filter(Boolean).join('\n  ');

    throw new Error(msg);
  }
}

beforeAll(async () => {
  console.log(`Running smoke tests against: ${BASE_URL}`);
  await checkHealth();
  console.log('  Health check passed.\n');
}, 30_000);
