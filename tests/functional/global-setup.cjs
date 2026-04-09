const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const rootDir = path.join(process.cwd());
const stateFilePath = path.join(
  rootDir,
  'coverage',
  'service-functional-api',
  'server-state.json',
);
const functionalServerV8CoverageDir =
  process.env.FUNCTIONAL_SERVER_V8_COVERAGE_DIR
  || path.join(rootDir, 'coverage', 'service-functional-api-v8');
const serverEntry = path.join(rootDir, 'tests', 'functional', 'server.ts');
const tsConfigPath = path.join(rootDir, 'tests', 'tsconfig.json');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStateFile(child, timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(stateFilePath)) {
      const raw = fs.readFileSync(stateFilePath, 'utf8');
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.baseUrl === 'string' && typeof parsed.pid === 'number') {
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

module.exports = async () => {
  fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
  if (fs.existsSync(stateFilePath)) {
    fs.rmSync(stateFilePath, { force: true });
  }

  const runId = randomUUID();
  const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', serverEntry], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      AUTO_START_SCHEDULER: 'false',
      FUNCTIONAL_RUN_ID: runId,
      FUNCTIONAL_SERVER_STATE_FILE: stateFilePath,
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

  await waitForStateFile(child);
};
