const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(process.cwd());
const stateFilePath = path.join(
  rootDir,
  'coverage',
  'service-functional-api',
  'server-state.json',
);

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
  const state = readState();
  if (state?.pid) {
    await terminatePid(state.pid);
  }

  if (fs.existsSync(stateFilePath)) {
    fs.rmSync(stateFilePath, { force: true });
  }
};
