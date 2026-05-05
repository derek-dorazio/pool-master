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

// Wait briefly for the parent-watchdog in tests/functional/server.ts to detect
// the jest CLI's exit and self-terminate (5 s poll + a small buffer). Then verify
// no daemon servers survived. This is the regression check for pool-master-rop.71.1
// — before that fix, even a clean fapi run left orphaned `tests/functional/server.ts`
// processes pinned to Postgres connections, eventually causing "Too many database
// connections" outages.
const orphanCheckResult = spawnSync('sh', ['-c', 'sleep 8 && ps ax -o pid,command | grep "tests/functional/server.ts" | grep -v grep'], {
  encoding: 'utf8',
});
const orphanLines = (orphanCheckResult.stdout ?? '').trim().split('\n').filter((line) => line.length > 0);

if (orphanLines.length > 0) {
  process.stderr.write(
    `\nFAPI server leak detected — ${orphanLines.length} daemon process(es) survived globalTeardown:\n`,
  );
  for (const line of orphanLines) process.stderr.write(`  ${line.trim()}\n`);
  process.stderr.write(
    `Cleaning up with pkill before exiting. If this happens repeatedly, see pool-master-rop.71.1.\n\n`,
  );
  spawnSync('pkill', ['-f', 'tests/functional/server.ts']);
  // Failed cleanup is a real CI signal — exit non-zero even if jest itself passed.
  process.exit(jestResult.status === 0 ? 2 : (jestResult.status ?? 1));
}

process.exit(jestResult.status ?? 1);
