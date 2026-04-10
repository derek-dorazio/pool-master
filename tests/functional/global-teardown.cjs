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

  return fs.readdirSync(runsDir, { withFileTypes: true }).some((entry) => {
    if (!entry.isDirectory()) {
      return false;
    }
    return fs.existsSync(path.join(runsDir, entry.name, 'server-state.json'));
  });
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
