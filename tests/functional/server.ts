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

  // Idempotent shutdown — multiple triggers (SIGTERM + watchdog) can fire concurrently
  // when the parent dies abruptly mid-shutdown. Without the guard, app.close() would be
  // called twice, which can deadlock or surface confusing teardown errors. See
  // pool-master-rop.71.1.
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
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

  // Parent watchdog (pool-master-rop.71.1):
  //
  // Belt-and-suspenders for jest's globalTeardown not always running. Failure modes
  // observed today caused 14 daemon servers to accumulate as zombies:
  //
  //   1. fapi run killed mid-flight (e.g., concurrent `pkill` from sibling agent
  //      harness, or terminal closed) — globalTeardown never executes; daemon orphans.
  //   2. globalTeardown's `hasActiveRunStateFiles()` returns true due to a stale
  //      state file from a previously-crashed run, so it bails without sending
  //      SIGTERM, even though no run is actually still active.
  //   3. jest --forceExit cuts globalTeardown's async work short before its SIGTERM
  //      polling completes.
  //
  // In each case the daemon's parent (the jest CLI process) eventually dies. By
  // polling the parent PID and self-terminating on ESRCH, the daemon cleans itself up
  // regardless of whether teardown ran. Polling interval is 5 s — leak duration is
  // bounded.
  const parentPid = process.ppid;
  if (parentPid && parentPid > 1) {
    const watchdog = setInterval(() => {
      try {
        process.kill(parentPid, 0); // signal 0 = existence check only
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          clearInterval(watchdog);
          void shutdown();
        }
      }
    }, 5_000);
    watchdog.unref(); // don't block process exit on the timer itself
  }
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await smtpSink?.close().catch(() => undefined);
  if (stateFilePath) {
    await fs.rm(stateFilePath, { force: true }).catch(() => undefined);
  }
  process.exit(1);
});
