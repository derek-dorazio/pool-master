/**
 * Export OpenAPI spec from the Fastify app.
 *
 * Sets DATABASE_URL to a dummy value so Prisma doesn't try to connect,
 * boots the app (without listening), calls app.swagger() to get the
 * generated spec, and writes it to packages/shared/generated/openapi.json.
 *
 * Usage: npx tsx packages/core-api/scripts/export-openapi.ts
 */

// Prevent Prisma from connecting to a real database
process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'development';

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  // Dynamic import after env vars are set
  const { buildApp } = await import('../src/index');
  const app = buildApp();

  // ready() registers all plugins and routes — swagger needs this
  // Prisma will fail to connect but routes are still registered
  try {
    await app.ready();
  } catch {
    // Ignore Prisma connection errors — we only need routes registered
  }

  // Get the generated OpenAPI spec
  const spec = (app as any).swagger?.();
  if (!spec) {
    console.error('swagger() not available — is @fastify/swagger registered?');
    process.exit(1);
  }

  const outPath = resolve(__dirname, '../../../packages/shared/generated/openapi.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');

  console.log(`OpenAPI spec exported to ${outPath}`);
  console.log(`  Paths: ${Object.keys(spec.paths ?? {}).length}`);
  console.log(`  Version: ${spec.info?.version}`);

  try { await app.close(); } catch { /* ignore */ }
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to export OpenAPI spec:', err);
  process.exit(1);
});
