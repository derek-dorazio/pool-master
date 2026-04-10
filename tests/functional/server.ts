import fs from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from '../../packages/core-api/src/index';

const stateFilePath = process.env.FUNCTIONAL_SERVER_STATE_FILE;
const runId = process.env.FUNCTIONAL_RUN_ID ?? 'functional-run';

if (!stateFilePath) {
  throw new Error('FUNCTIONAL_SERVER_STATE_FILE is required');
}

async function writeState(port: number): Promise<void> {
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  await fs.writeFile(
    stateFilePath,
    JSON.stringify({
      pid: process.pid,
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      runId,
    }),
  );
}

async function main(): Promise<void> {
  const app = buildApp();

  await app.ready();
  await app.listen({ host: '127.0.0.1', port: 0 });

  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Functional server failed to bind to a TCP port');
  }

  await writeState(address.port);

  const shutdown = async (): Promise<void> => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  if (stateFilePath) {
    await fs.rm(stateFilePath, { force: true }).catch(() => undefined);
  }
  process.exit(1);
});
