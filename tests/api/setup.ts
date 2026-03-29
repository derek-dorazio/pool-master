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

beforeAll(async () => {
  console.log(`Running smoke tests against: ${BASE_URL}`);
  await checkHealth();
  console.log('  Health check passed.\n');
}, 30_000);
