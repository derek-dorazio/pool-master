import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClient } from '@hey-api/openapi-ts';

const root = process.cwd();

// Each step normally takes seconds. The limit turns a hung step into a fast failure that
// names it, instead of a silent wait for the job's own timeout. On 2026-10-18 the hey-api
// CLI printed "Done!" and then never exited, twice, so generation now runs in this process.
const STEP_TIMEOUT_MS = 120_000;

function seconds(ms) {
  return `${ms / 1000}s`;
}

export function runStep(command, args, { env = {}, timeoutMs = STEP_TIMEOUT_MS } = {}) {
  const label = `${command} ${args.join(' ')}`;
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });

  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`${label} did not finish within ${seconds(timeoutMs)} and was stopped`);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status ?? `unknown (signal ${result.signal})`}`,
    );
  }
}

// hey-api rejects with a JobError whose own message is empty; the cause is on originalError.error.
export function errorMessage(error) {
  const cause = error?.originalError?.error ?? error;
  return cause instanceof Error ? cause.message : String(cause);
}

export function withTimeout(promise, timeoutMs, label) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const pending = process.getActiveResourcesInfo().join(', ') || 'none';
      reject(
        new Error(`${label} did not finish within ${seconds(timeoutMs)} (pending: ${pending})`),
      );
    }, timeoutMs);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];

  function visit(path) {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const child of readdirSync(path)) {
        visit(join(path, child));
      }
      return;
    }
    if (stats.isFile()) files.push(path);
  }

  visit(dir);
  return files.sort();
}

function compareFile(committedPath, generatedPath, label, differences) {
  if (!existsSync(committedPath)) {
    differences.push(`${label}: committed file is missing at ${relative(root, committedPath)}`);
    return;
  }
  if (!existsSync(generatedPath)) {
    differences.push(`${label}: generated file is missing at ${generatedPath}`);
    return;
  }
  const committed = readFileSync(committedPath, 'utf8');
  const generated = readFileSync(generatedPath, 'utf8');
  if (committed !== generated) {
    differences.push(`${label}: ${relative(root, committedPath)} is stale`);
  }
}

function compareDirectories(committedDir, generatedDir, label, differences) {
  const committedFiles = listFiles(committedDir).map((path) => relative(committedDir, path));
  const generatedFiles = listFiles(generatedDir).map((path) => relative(generatedDir, path));
  const allFiles = new Set([...committedFiles, ...generatedFiles]);

  for (const file of [...allFiles].sort()) {
    const committedPath = join(committedDir, file);
    const generatedPath = join(generatedDir, file);
    if (!committedFiles.includes(file)) {
      differences.push(`${label}: generated new file ${file}`);
      continue;
    }
    if (!generatedFiles.includes(file)) {
      differences.push(`${label}: committed file no longer generated ${file}`);
      continue;
    }
    compareFile(committedPath, generatedPath, `${label}/${file}`, differences);
  }
}

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'poolmaster-openapi-check-'));
  try {
    const tempOpenApi = join(tempRoot, 'openapi.json');
    const tempGenerated = join(tempRoot, 'hey-api');

    runStep('node', ['--import', 'tsx', 'packages/core-api/scripts/export-openapi.ts'], {
      env: { OPENAPI_OUTPUT_PATH: tempOpenApi },
    });

    await withTimeout(
      createClient({ input: tempOpenApi, output: { path: tempGenerated } }),
      STEP_TIMEOUT_MS,
      'hey-api client generation',
    );

    const tempApiTypes = join(tempRoot, 'api-types.ts');
    runStep('npx', ['openapi-typescript', tempOpenApi, '-o', tempApiTypes]);

    const differences = [];
    compareFile(
      resolve(root, 'packages/shared/generated/openapi.json'),
      tempOpenApi,
      'OpenAPI spec',
      differences,
    );
    compareDirectories(
      resolve(root, 'packages/shared/generated/hey-api'),
      tempGenerated,
      'hey-api client',
      differences,
    );
    compareFile(
      resolve(root, 'packages/shared/generated/api-types.ts'),
      tempApiTypes,
      'api-types.ts',
      differences,
    );

    if (differences.length > 0) {
      console.error('Generated API artifacts are stale. Run npm run api:refresh.');
      for (const difference of differences) {
        console.error(`- ${difference}`);
      }
      process.exitCode = 1;
    } else {
      console.log('Generated OpenAPI and hey-api artifacts are fresh.');
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
  // Exit explicitly: a handle left open by the generator must not hold the job open.
  process.exit(process.exitCode ?? 0);
}
