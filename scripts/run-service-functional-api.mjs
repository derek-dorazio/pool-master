import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();

function run(command, args, env = process.env) {
  return spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env,
  });
}

const invocationId = process.env.FUNCTIONAL_INVOCATION_ID ?? randomUUID();
const stateDir = process.env.FUNCTIONAL_STATE_DIR ?? path.join(
  rootDir,
  'coverage',
  'service-functional-api',
  'runs',
  invocationId,
);
const stateFilePath = process.env.FUNCTIONAL_SERVER_STATE_FILE ?? path.join(
  stateDir,
  'server-state.json',
);
const runId = process.env.FUNCTIONAL_RUN_ID ?? invocationId;

fs.mkdirSync(stateDir, { recursive: true });

const env = {
  ...process.env,
  FUNCTIONAL_INVOCATION_ID: invocationId,
  FUNCTIONAL_RUN_ID: runId,
  FUNCTIONAL_STATE_DIR: stateDir,
  FUNCTIONAL_SERVER_STATE_FILE: stateFilePath,
};

const buildResult = run('npm', ['run', 'build', '--workspace', '@poolmaster/shared'], env);
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const jestResult = run(
  'npx',
  ['jest', '--config', 'tests/functional/jest.config.js', '--forceExit', ...process.argv.slice(2)],
  env,
);

// Snapshot the daemon's PID BEFORE deleting this run's state directory — the
// daemon state file at `coverage/service-functional-api/daemon/server-state.json`
// stays put across runs (it's the shared-daemon registry, not our per-run state),
// but we want to remember which specific PID we believed was alive when this
// run finished so we don't misclassify a sibling run's daemon as our orphan.
const daemonStateFile = path.join(rootDir, 'coverage', 'service-functional-api', 'daemon', 'server-state.json');
const runsRoot = path.join(rootDir, 'coverage', 'service-functional-api', 'runs');

let knownDaemonPid = null;
if (fs.existsSync(daemonStateFile)) {
  try {
    const ds = JSON.parse(fs.readFileSync(daemonStateFile, 'utf8'));
    if (typeof ds?.pid === 'number') knownDaemonPid = ds.pid;
  } catch {
    // ignore — we'll just skip the orphan check if we can't identify our daemon
  }
}

fs.rmSync(stateDir, { recursive: true, force: true });

// Wait briefly for the parent-watchdog in tests/functional/server.ts to detect
// the jest CLI's exit and self-terminate (5 s poll + a small buffer). Then check
// for an orphan, scoped to THIS run's known daemon PID (not a global pkill).
//
// Per pool-master-rop.71.1 (Codex Pass 2 P1 finding 2): the previous orphan-check
// implementation matched ANY `tests/functional/server.ts` process and pkill'd them
// all, which would destroy a sibling concurrent fapi run's daemon. The fixed check
// only kills the specific PID this run knew was its daemon, AND skips the kill
// entirely if other concurrent runs are still using that daemon.
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && error.code === 'ESRCH');
  }
}

function activeRunsExist() {
  if (!fs.existsSync(runsRoot)) return false;
  for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sf = path.join(runsRoot, entry.name, 'server-state.json');
    if (!fs.existsSync(sf)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(sf, 'utf8'));
      if (typeof state?.runnerPid === 'number' && isPidAlive(state.runnerPid)) {
        return true;
      }
    } catch {
      // ignore malformed
    }
  }
  return false;
}

if (knownDaemonPid !== null) {
  // Wait through the watchdog poll window (5 s) plus a small buffer for shutdown.
  spawnSync('sh', ['-c', 'sleep 8']);

  if (isPidAlive(knownDaemonPid) && !activeRunsExist()) {
    // Our daemon is alive AND no other concurrent run is using it — that's a leak.
    process.stderr.write(
      `\nFAPI server leak detected — daemon PID ${knownDaemonPid} still running with no active run-state references after this run completed.\n`,
    );
    process.stderr.write(
      `Sending SIGTERM, escalating to SIGKILL after 2 s. If this happens repeatedly, see pool-master-rop.71.1.\n\n`,
    );
    try {
      process.kill(knownDaemonPid, 'SIGTERM');
    } catch {
      /* already dead */
    }
    spawnSync('sh', ['-c', 'sleep 2']);
    if (isPidAlive(knownDaemonPid)) {
      try {
        process.kill(knownDaemonPid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    }
    // Failed cleanup is a real CI signal — exit non-zero even if jest itself passed.
    process.exit(jestResult.status === 0 ? 2 : (jestResult.status ?? 1));
  }
}

process.exit(jestResult.status ?? 1);
