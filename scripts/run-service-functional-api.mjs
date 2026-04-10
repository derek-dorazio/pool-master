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

fs.rmSync(stateDir, { recursive: true, force: true });
process.exit(jestResult.status ?? 1);
