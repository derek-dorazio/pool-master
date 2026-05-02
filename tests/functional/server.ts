import fs from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from '../../packages/core-api/src/index';
import { startSmtpSinkServer, type SmtpSinkServer } from '../support/smtp-sink';

const stateFilePath = process.env.FUNCTIONAL_SERVER_STATE_FILE;
const runId = process.env.FUNCTIONAL_RUN_ID ?? 'functional-run';

if (!stateFilePath) {
  throw new Error('FUNCTIONAL_SERVER_STATE_FILE is required');
}

let smtpSink: SmtpSinkServer | undefined;

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
  smtpSink = await startSmtpSinkServer();
  process.env.EMAIL_PROVIDER = 'smtp';
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(smtpSink.port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_FROM = 'noreply@functional.test';
  delete process.env.SMTP_USERNAME;
  delete process.env.SMTP_PASSWORD;

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
      await smtpSink?.close().catch(() => undefined);
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
  await smtpSink?.close().catch(() => undefined);
  if (stateFilePath) {
    await fs.rm(stateFilePath, { force: true }).catch(() => undefined);
  }
  process.exit(1);
});
