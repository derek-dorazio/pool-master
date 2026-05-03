import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), 'poolmaster-openapi-check-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
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

try {
  const tempOpenApi = join(tempRoot, 'openapi.json');
  const tempGenerated = join(tempRoot, 'hey-api');
  const tempConfig = join(tempRoot, 'openapi-ts.config.mjs');

  run('node', ['--import', 'tsx', 'packages/core-api/scripts/export-openapi.ts'], {
    env: { OPENAPI_OUTPUT_PATH: tempOpenApi },
  });

  writeFileSync(
    tempConfig,
    [
      'export default {',
      `  input: ${JSON.stringify(tempOpenApi)},`,
      '  output: {',
      `    path: ${JSON.stringify(tempGenerated)}`,
      '  },',
      "  client: '@hey-api/client-fetch',",
      '};',
      '',
    ].join('\n'),
  );

  run('npx', ['@hey-api/openapi-ts', '-f', tempConfig]);

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
