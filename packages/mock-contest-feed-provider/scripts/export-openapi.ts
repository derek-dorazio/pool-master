import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  const { buildApp } = await import('../src/app');
  const app = buildApp();

  try {
    await app.ready();
  } catch (error) {
    app.log.error({ error }, 'Mock contest feed app.ready() failed');
  }

  const spec = (app as unknown as { swagger?: () => unknown }).swagger?.();
  if (!spec) {
    console.error('swagger() not available — is @fastify/swagger registered?');
    process.exit(1);
  }

  const generatedDir = resolve(process.cwd(), 'generated');
  mkdirSync(generatedDir, { recursive: true });

  const outPath = resolve(generatedDir, 'openapi.json');
  writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);

  console.log(`OpenAPI spec exported to ${outPath}`);

  try {
    await app.close();
  } catch {
    // Ignore shutdown errors in export mode.
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Failed to export OpenAPI spec:', error);
  process.exit(1);
});
