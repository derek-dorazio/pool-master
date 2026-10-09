/**
 * Writes `version-info.json`, the one record of which build of core-api this is (#180).
 *
 * `/version` and the `version` field on every log line read this file through
 * `src/core/version-info.ts`; nothing reads build identity from the runtime environment.
 * The file sits next to `package.json`, which is `packages/core-api/` in the repo and
 * `/app` in the image, so the same relative path finds it from `src/` and `dist/`.
 *
 * Inputs are the build's own facts, supplied by whoever builds:
 *   POOLMASTER_SERVICE_VERSION  required -- the build fails without it
 *   POOLMASTER_SERVICE_GIT_SHA  optional -- null when not supplied
 *   POOLMASTER_BUILD_NUMBER     optional -- null when not supplied
 *   POOLMASTER_GIT_REF          optional -- null when not supplied
 *   POOLMASTER_BUILD_TIME_UTC   optional -- the moment this script runs, which is the build
 *
 * There is no `?? 'literal'` for the version: a build that cannot say what it is fails here
 * rather than shipping a file that claims to be `0.1.0` or `development`. Which environment
 * the build runs in is not recorded: one image runs in many, so that is
 * `POOLMASTER_ENVIRONMENT` at runtime.
 *
 * Usage: node scripts/write-version-info.mjs [--out-dir <dir>] [--print-default-path]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE_NAME = 'version-info.json';

function optional(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function outDirFromArgs(args) {
  const index = args.indexOf('--out-dir');
  if (index === -1) return PACKAGE_ROOT;
  const dir = args[index + 1];
  if (!dir) throw new Error('--out-dir needs a directory.');
  return path.resolve(dir);
}

const args = process.argv.slice(2);
if (args.includes('--print-default-path')) {
  console.log(path.join(PACKAGE_ROOT, FILE_NAME));
  process.exit(0);
}

const version = optional('POOLMASTER_SERVICE_VERSION');
if (!version) {
  console.error(
    'POOLMASTER_SERVICE_VERSION is required to write version-info.json. CI passes the commit '
    + 'SHA; set it yourself for a local build (see .env.example).',
  );
  process.exit(1);
}

const info = {
  schemaVersion: 1,
  buildTimeUtc: optional('POOLMASTER_BUILD_TIME_UTC') ?? new Date().toISOString(),
  gitRef: optional('POOLMASTER_GIT_REF'),
  service: {
    name: '@poolmaster/core-api',
    version,
    gitSha: optional('POOLMASTER_SERVICE_GIT_SHA'),
    buildNumber: optional('POOLMASTER_BUILD_NUMBER'),
  },
};

const outDir = outDirFromArgs(args);
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, FILE_NAME);
writeFileSync(outFile, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outFile} (service version ${version})`);
