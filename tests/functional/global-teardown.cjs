const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(process.cwd());
const invocationId = process.env.FUNCTIONAL_INVOCATION_ID;
const coverageRoot = path.join(
  rootDir,
  'coverage',
  'service-functional-api',
);
const stateDir = process.env.FUNCTIONAL_STATE_DIR || (
  invocationId
    ? path.join(coverageRoot, 'runs', invocationId)
    : coverageRoot
);
const stateFilePath = process.env.FUNCTIONAL_SERVER_STATE_FILE || path.join(
  stateDir,
  'server-state.json',
);
const runsDir = path.join(coverageRoot, 'runs');
const daemonDir = path.join(coverageRoot, 'daemon');
const daemonStateFilePath = path.join(daemonDir, 'server-state.json');

function readState() {
  if (!fs.existsSync(stateFilePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  } catch {
    return null;
  }
}

function hasActiveRunStateFiles() {
  if (!fs.existsSync(runsDir)) {
    return false;
  }

  // Per pool-master-rop.71.1: a state file's mere existence is not proof of an
  // active run — crashed runs leave stale files that previously caused this
  // function to keep the shared daemon alive even though no run was using it.
  // Liveness is determined by probing the runnerPid embedded in each state
  // file (the jest CLI pid, varies per run). Stale entries are removed in-place
  // so future checks do not keep reviving the daemon either.
  let active = false;
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const stateFile = path.join(runsDir, entry.name, 'server-state.json');
    if (!fs.existsSync(stateFile)) continue;
    let runnerPid = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (typeof parsed?.runnerPid === 'number') runnerPid = parsed.runnerPid;
    } catch {
      // Malformed file — treat as stale below.
    }
    if (runnerPid && isPidAlive(runnerPid)) {
      active = true;
      // Keep iterating so stale neighbours still get cleaned.
      continue;
    }
    fs.rmSync(path.join(runsDir, entry.name), { recursive: true, force: true });
  }
  return active;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && error.code === 'ESRCH');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminatePid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error && error.code !== 'ESRCH') {
      throw error;
    }
    return;
  }

  for (let i = 0; i < 20; i += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error && error.code === 'ESRCH') {
        return;
      }
      throw error;
    }
    await sleep(250);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error && error.code !== 'ESRCH') {
      throw error;
    }
  }
}

module.exports = async () => {
  if (fs.existsSync(stateFilePath)) {
    fs.rmSync(stateFilePath, { force: true });
  }

  if (process.env.FUNCTIONAL_STATE_DIR && fs.existsSync(stateDir)) {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  if (hasActiveRunStateFiles()) {
    return;
  }

  const daemonState = readState(daemonStateFilePath);
  if (daemonState?.pid) {
    await terminatePid(daemonState.pid);
  }

  if (fs.existsSync(daemonStateFilePath)) {
    fs.rmSync(daemonStateFilePath, { force: true });
  }

  if (fs.existsSync(daemonDir)) {
    fs.rmSync(daemonDir, { recursive: true, force: true });
  }
};
