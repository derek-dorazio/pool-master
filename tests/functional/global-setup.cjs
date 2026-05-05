const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const rootDir = path.join(process.cwd());
const invocationId = process.env.FUNCTIONAL_INVOCATION_ID || randomUUID();
const stateDir = process.env.FUNCTIONAL_STATE_DIR || path.join(
  rootDir,
  'coverage',
  'service-functional-api',
  'runs',
  invocationId,
);
const stateFilePath = process.env.FUNCTIONAL_SERVER_STATE_FILE || path.join(
  stateDir,
  'server-state.json',
);
const daemonDir = path.join(
  rootDir,
  'coverage',
  'service-functional-api',
  'daemon',
);
const daemonStateFilePath = path.join(daemonDir, 'server-state.json');
const daemonLockDir = path.join(daemonDir, 'startup.lock');
const functionalServerV8CoverageDir =
  process.env.FUNCTIONAL_SERVER_V8_COVERAGE_DIR
  || path.join(rootDir, 'coverage', 'service-functional-api-v8');
const serverEntry = path.join(rootDir, 'tests', 'functional', 'server.ts');
const tsConfigPath = path.join(rootDir, 'tests', 'tsconfig.json');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerReachable(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForStateFile(filePath, child, timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        if (
          parsed
          && typeof parsed.baseUrl === 'string'
          && typeof parsed.pid === 'number'
          && await isServerReachable(parsed.baseUrl)
        ) {
          return parsed;
        }
      }
    }

    if (child.exitCode !== null) {
      throw new Error(`Functional server exited early with code ${child.exitCode}`);
    }

    await wait(250);
  }

  throw new Error('Timed out waiting for the functional test server to start.');
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.baseUrl === 'string' && typeof parsed.pid === 'number') {
      return parsed;
    }
  } catch {}

  return null;
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && error.code === 'ESRCH');
  }
}

function removeRunStateDirs() {
  const runsDir = path.join(rootDir, 'coverage', 'service-functional-api', 'runs');
  if (!fs.existsSync(runsDir)) {
    return;
  }

  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    fs.rmSync(path.join(runsDir, entry.name), { recursive: true, force: true });
  }
}

async function waitForDaemonState(timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = readState(daemonStateFilePath);
    if (
      state?.pid
      && isPidRunning(state.pid)
      && await isServerReachable(state.baseUrl)
    ) {
      return state;
    }
    await wait(250);
  }

  throw new Error('Timed out waiting for the shared functional test server daemon.');
}

function writeRunState(serverState, runId) {
  fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
  fs.writeFileSync(
    stateFilePath,
    JSON.stringify({
      // pid is the shared daemon's pid (used by teardown to send SIGTERM when
      // no other runs are still active).
      pid: serverState.pid,
      // runnerPid is THIS jest CLI's pid (varies per concurrent run). Probed
      // for liveness by global-teardown's hasActiveRunStateFiles, server.ts's
      // watchdog, and run-service-functional-api.mjs's orphan check — together
      // they distinguish active concurrent runs from stale state files left
      // by crashed runs. Critical for concurrent-fapi safety per
      // pool-master-rop.71.1 (Codex Pass 2 P1 finding 1).
      runnerPid: process.pid,
      port: serverState.port,
      baseUrl: serverState.baseUrl,
      runId,
    }),
  );
}

async function startDaemon(runId) {
  const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', serverEntry], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      AUTO_START_SCHEDULER: 'false',
      FUNCTIONAL_INVOCATION_ID: invocationId,
      FUNCTIONAL_RUN_ID: runId,
      FUNCTIONAL_STATE_DIR: daemonDir,
      FUNCTIONAL_SERVER_STATE_FILE: daemonStateFilePath,
      FUNCTIONAL_SERVER_V8_COVERAGE_DIR: functionalServerV8CoverageDir,
      JWT_SECRET: 'poolmaster-dev-secret-change-in-production',
      NODE_V8_COVERAGE: functionalServerV8CoverageDir,
      OPENAPI_EXPORT: 'false',
      POOLMASTER_DISABLE_AUTO_START: 'true',
      TS_NODE_PROJECT: tsConfigPath,
    },
  });

  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(
        `Functional test server exited unexpectedly with code ${code}${signal ? ` signal ${signal}` : ''}\n`,
      );
    }
  });

  return waitForStateFile(daemonStateFilePath, child);
}

async function ensureSharedServer(runId) {
  const existingState = readState(daemonStateFilePath);
  if (
    existingState?.pid
    && isPidRunning(existingState.pid)
    && await isServerReachable(existingState.baseUrl)
  ) {
    return existingState;
  }

  fs.rmSync(daemonStateFilePath, { force: true });
  removeRunStateDirs();

  fs.mkdirSync(daemonDir, { recursive: true });

  try {
    fs.mkdirSync(daemonLockDir);
  } catch (error) {
    if (!error || error.code !== 'EEXIST') {
      throw error;
    }
    return waitForDaemonState();
  }

  try {
    return await startDaemon(runId);
  } finally {
    fs.rmSync(daemonLockDir, { recursive: true, force: true });
  }
}

module.exports = async () => {
  fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
  if (fs.existsSync(stateFilePath)) {
    fs.rmSync(stateFilePath, { force: true });
  }

  const runId = process.env.FUNCTIONAL_RUN_ID || randomUUID();
  const serverState = await ensureSharedServer(runId);
  writeRunState(serverState, runId);
};
