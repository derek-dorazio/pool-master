/**
 * API smoke test setup — verifies all services are running before tests execute.
 *
 * Prerequisites: npm run dev:start (Docker + all services must be running)
 */

const SERVICES = [
  { name: 'Core API', url: 'http://localhost:3000/health' },
  { name: 'Draft Service', url: 'http://localhost:3001/health' },
  { name: 'Scoring Service', url: 'http://localhost:3002/health' },
  { name: 'Ingestion Worker', url: 'http://localhost:3003/health' },
  { name: 'Notification Service', url: 'http://localhost:3004/health' },
];

async function checkService(name: string, url: string): Promise<void> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw new Error(`${name} returned ${response.status}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${name} is not running at ${url}.\n` +
      `  Error: ${message}\n` +
      `  Run "npm run dev:start" to start all services before running API tests.`,
    );
  }
}

beforeAll(async () => {
  console.log('Checking that all services are running...');
  const results: string[] = [];

  for (const service of SERVICES) {
    try {
      await checkService(service.name, service.url);
      results.push(`  ✓ ${service.name}`);
    } catch (err) {
      results.push(`  ✗ ${service.name}`);
      console.error(results.join('\n'));
      throw err;
    }
  }

  console.log(results.join('\n'));
  console.log('All services healthy.\n');
}, 30_000);
