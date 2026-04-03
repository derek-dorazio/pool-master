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
process.env.OPENAPI_EXPORT = 'true';

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
  } catch (err) {
    console.error('OpenAPI export app.ready() failed:', err);
    // Ignore Prisma connection errors — we only need routes registered
  }

  // Get the generated OpenAPI spec
  const spec = (app as any).swagger?.();
  if (!spec) {
    console.error('swagger() not available — is @fastify/swagger registered?');
    process.exit(1);
  }

  // Resolve local $ref pointers that @fastify/swagger creates when identical
  // sub-schemas are reused.  These local refs (e.g. "#/properties/activeTenants")
  // are relative to the individual schema node, not the spec root, so
  // openapi-typescript and @hey-api cannot follow them.
  function resolveRefs(node: unknown, schemaRoot: unknown): unknown {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((i) => resolveRefs(i, schemaRoot));
    const obj = node as Record<string, unknown>;
    if (typeof obj.$ref === 'string' && (obj.$ref as string).startsWith('#/')) {
      const parts = (obj.$ref as string).slice(2).split('/');
      let target: unknown = schemaRoot;
      for (const p of parts) {
        if (target === null || typeof target !== 'object') return obj;
        target = (target as Record<string, unknown>)[p];
      }
      return resolveRefs(target, schemaRoot);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveRefs(v, schemaRoot);
    }
    return out;
  }

  // Walk every operation's schema objects and resolve local $refs
  for (const methods of Object.values(spec.paths ?? {})) {
    for (const op of Object.values(methods as Record<string, any>)) {
      if (!op || typeof op !== 'object') continue;
      // Resolve refs in request body schemas
      if (op.requestBody?.content) {
        for (const media of Object.values(op.requestBody.content as Record<string, any>)) {
          if (media?.schema) media.schema = resolveRefs(media.schema, media.schema);
        }
      }
      // Resolve refs in response schemas
      if (op.responses) {
        for (const resp of Object.values(op.responses as Record<string, any>)) {
          if (resp?.content) {
            for (const media of Object.values(resp.content as Record<string, any>)) {
              if (media?.schema) media.schema = resolveRefs(media.schema, media.schema);
            }
          }
        }
      }
    }
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
