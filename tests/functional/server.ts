import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { buildApp } from '../../packages/core-api/src/index';
import { startSmtpSinkServer, type SmtpSinkServer } from '../support/smtp-sink';

const stateFilePath = process.env.FUNCTIONAL_SERVER_STATE_FILE;
const runId = process.env.FUNCTIONAL_RUN_ID ?? 'functional-run';

if (!stateFilePath) {
  throw new Error('FUNCTIONAL_SERVER_STATE_FILE is required');
}

let smtpSink: SmtpSinkServer | undefined;

// Daemon's state file lives at `<coverage>/service-functional-api/daemon/server-state.json`.
// Per-run state files live at `<coverage>/service-functional-api/runs/<id>/server-state.json`.
// The runs root is `daemon/..` + `runs`.
const runsRoot = path.join(path.dirname(stateFilePath), '..', 'runs');

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Returns true if at least one per-run state file points at a still-alive
 * jest runner PID. Stale entries (runner already exited) are cleaned up
 * in-place. Used by the parent watchdog to decide whether self-shutdown is
 * safe under the shared-daemon design (multiple concurrent fapi runs may
 * share a single daemon; killing it on the spawning runner's exit would
 * destroy other runs mid-flight).
 */
function activeRunsExist(): boolean {
  if (!fsSync.existsSync(runsRoot)) {
    return false;
  }
  let found = false;
  for (const entry of fsSync.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sf = path.join(runsRoot, entry.name, 'server-state.json');
    if (!fsSync.existsSync(sf)) continue;
    try {
      const state = JSON.parse(fsSync.readFileSync(sf, 'utf8')) as { runnerPid?: number };
      if (typeof state.runnerPid === 'number' && isPidAlive(state.runnerPid)) {
        found = true;
        // Keep iterating so stale neighbours still get cleaned.
        continue;
      }
    } catch {
      // Malformed file — treat as stale below.
    }
    // Stale entry — remove it so a future check doesn't keep reviving the daemon.
    fsSync.rmSync(path.join(runsRoot, entry.name), { recursive: true, force: true });
  }
  return found;
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

  // Parent watchdog (pool-master-rop.71.1) — concurrent-safe:
  //
  // Belt-and-suspenders for jest's globalTeardown not always running. Failure modes
  // that caused 14 daemon servers to accumulate as zombies during 2026-05-04 work:
  //
  //   1. fapi run killed mid-flight (concurrent `pkill` from sibling agent harness,
  //      terminal closed) — globalTeardown never executed; daemon orphaned.
  //   2. globalTeardown's `hasActiveRunStateFiles()` returned true due to stale state
  //      files from previously-crashed runs, bailing without sending SIGTERM even
  //      though no run was actually still active.
  //   3. jest --forceExit cut globalTeardown's async work short before its SIGTERM
  //      polling completed.
  //
  // The daemon's parent (the jest CLI that originally spawned it via global-setup.cjs)
  // eventually dies in each case. The watchdog polls that parent PID and shuts down
  // when it goes away — BUT NOT IF other concurrent runs are still using this shared
  // daemon. The fapi harness intentionally shares one daemon across N concurrent jest
  // runs; killing it on the original spawner's exit would destroy any sibling run
  // mid-flight. The activeRunsExist() check above gates the shutdown on per-run state
  // file liveness (each run writes its own runnerPid; stale entries get cleaned).
  //
  // Polling interval is 5 s — leak duration is bounded.
  const parentPid = process.ppid;
  if (parentPid && parentPid > 1) {
    const watchdog = setInterval(() => {
      try {
        process.kill(parentPid, 0); // signal 0 = existence check only
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          // Spawning parent gone. Are other concurrent runs still using us?
          if (activeRunsExist()) {
            // Yes — keep running. The other runs' teardowns will eventually take
            // over the shutdown path once they finish. Stale entries get cleaned
            // by activeRunsExist() so they don't keep us alive forever.
            return;
          }
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
