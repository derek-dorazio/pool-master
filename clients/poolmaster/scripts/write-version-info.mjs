import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(appRoot, 'package.json');
const distPath = path.join(appRoot, 'dist');
const versionInfoPath = path.join(distPath, 'version-info.json');

const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));

const webappVersion = process.env.POOLMASTER_WEBAPP_VERSION ?? packageJson.version;
const webappGitSha = process.env.POOLMASTER_WEBAPP_GIT_SHA ?? process.env.GITHUB_SHA ?? 'local';
const serviceVersion = process.env.POOLMASTER_SERVICE_VERSION ?? webappGitSha;
const serviceGitSha = process.env.POOLMASTER_SERVICE_GIT_SHA ?? serviceVersion;
const buildTimeUtc = process.env.POOLMASTER_BUILD_TIME_UTC ?? new Date().toISOString();
const environment = process.env.POOLMASTER_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
const releasePrefix = process.env.POOLMASTER_RELEASE_PREFIX ?? null;
const assetBase = process.env.APP_ASSET_BASE ?? '/';
const gitRef = process.env.POOLMASTER_GIT_REF ?? process.env.GITHUB_REF_NAME ?? null;

const versionInfo = {
  schemaVersion: 1,
  environment,
  buildTimeUtc,
  releasePrefix,
  assetBase,
  gitRef,
  webapp: {
    name: packageJson.name,
    version: webappVersion,
    gitSha: webappGitSha,
  },
  service: {
    name: '@poolmaster/core-api',
    version: serviceVersion,
    gitSha: serviceGitSha,
  },
};

await fs.mkdir(distPath, { recursive: true });
await fs.writeFile(versionInfoPath, `${JSON.stringify(versionInfo, null, 2)}\n`, 'utf8');

console.log(`Wrote ${path.relative(appRoot, versionInfoPath)}`);
