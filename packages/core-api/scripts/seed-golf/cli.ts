/**
 * Loads a sport data file (sport-data-file.ts) into a running PoolMaster as a root admin.
 *
 * Usage:
 *   POOLMASTER_SEED_BASE_URL=http://localhost:3000 \
 *   POOLMASTER_SEED_ADMIN_IDENTIFIER=poolmaster-admin \
 *   POOLMASTER_SEED_ADMIN_PASSWORD=... \
 *   npm run seed:golf -- [--file golf-2026.json] [--mode dry-run|apply] [--allow-test-data] [--report report.md]
 *                        [--event "<event name>"] [--replace-field] [--all-test-data] [--with-participants]
 *
 * --file is a path inside this folder (default golf-2026.json). --mode defaults to dry-run,
 * which reads the site and reports what applying would change without writing anything.
 * --allow-test-data lets a file with `testData: true` load; pass it only for a local or QA
 * site. --report also writes the run's markdown report to that path.
 *
 * --event names the event a test slate (test-slates/) fills; only a slate takes it, and a
 * slate needs it. --replace-field removes field rows the slate does not list instead of
 * withdrawing them.
 *
 * --all-test-data loads every test data file in this folder (not the test slates) in one run,
 * in place of --file; a file that fails is reported and the rest still load. --with-participants
 * also loads each test data file's test players, leagues, contests and entries
 * (test-participants.ts). Both are for QA only: the run reads the site's environment from
 * /version first and refuses anything that is not a test target. Every run is re-entrant, so
 * running again after a failure fills in what is missing.
 *
 * The base URL is the site root that serves /api/v1 (the API itself locally, the site on QA).
 * QA runs this through the "Load sport data" workflow, never on deploy.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createClient, createConfig, type Client } from '@poolmaster/shared/generated/hey-api/client';
import { getVersion, loginUser } from '@poolmaster/shared/generated/hey-api';
import { formatLoadReport, LoadMode } from './load-report';
import { loadSportData } from './seed-golf';
import { isTestSlate, parseSportDataFile, type SportDataFile } from './sport-data-file';
import { loadTestParticipants, refuseUnlessTestTarget } from './test-participants';

// Access tokens last 15 minutes; sign in again well before that.
const SIGN_IN_AGAIN_AFTER_MS = 10 * 60 * 1000;

// Named, not `string`, so each read is a variable declared in types/process-env.d.ts.
type SeedEnvName =
  | 'POOLMASTER_SEED_BASE_URL'
  | 'POOLMASTER_SEED_ADMIN_IDENTIFIER'
  | 'POOLMASTER_SEED_ADMIN_PASSWORD';

function requireEnv(name: SeedEnvName): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required.`);
    process.exit(1);
  }
  return value;
}

/** Signs in and returns a client that sends the session's access token. */
async function signIn(baseUrl: string, identifier: string, password: string): Promise<{ client: Client; isRootAdmin: boolean }> {
  const login = await loginUser({ client: createClient(createConfig({ baseUrl })), body: { identifier, password } });
  if (!login.data) {
    const status = login.response?.status ?? 'none';
    throw new Error(`Sign-in as ${identifier} failed (HTTP ${status}).`);
  }
  const { accessToken } = login.data.tokens;
  const client = createClient(createConfig({ baseUrl }));
  client.interceptors.request.use((request: Request) => {
    request.headers.set('Authorization', `Bearer ${accessToken}`);
    return request;
  });
  return { client, isRootAdmin: login.data.user.isRootAdmin };
}

/** The site's environment, from its public /version. */
async function siteEnvironment(baseUrl: string): Promise<string> {
  const version = await getVersion({ client: createClient(createConfig({ baseUrl })) });
  if (!version.data) throw new Error(`Reading ${baseUrl}/api/v1/version failed (HTTP ${version.response?.status ?? 'none'}).`);
  return version.data.environment;
}

/** Every data file in the folder, by name. Test slates sit in their own folder, so none is listed. */
function allDataFiles(dataDir: string): string[] {
  return readdirSync(dataDir).filter((name) => name.endsWith('.json')).sort();
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('POOLMASTER_SEED_BASE_URL').replace(/\/$/, '');
  const identifier = requireEnv('POOLMASTER_SEED_ADMIN_IDENTIFIER');
  const password = requireEnv('POOLMASTER_SEED_ADMIN_PASSWORD');
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      mode: { type: 'string', default: 'dry-run' },
      'allow-test-data': { type: 'boolean', default: false },
      report: { type: 'string' },
      event: { type: 'string' },
      'replace-field': { type: 'boolean', default: false },
      'all-test-data': { type: 'boolean', default: false },
      'with-participants': { type: 'boolean', default: false },
    },
  });
  const mode = values.mode === 'apply' ? LoadMode.APPLY : values.mode === 'dry-run' ? LoadMode.DRY_RUN : null;
  if (mode === null) throw new Error(`--mode is ${values.mode}; use dry-run or apply.`);
  const allTestData = values['all-test-data'];
  const withParticipants = values['with-participants'];
  if (allTestData && (values.file !== undefined || values.event !== undefined || values['replace-field'])) {
    throw new Error('--all-test-data loads every test data file; it takes no --file, --event or --replace-field.');
  }
  if ((allTestData || withParticipants) && !values['allow-test-data']) {
    throw new Error('--all-test-data and --with-participants load test data; pass --allow-test-data too.');
  }
  if (allTestData || withParticipants) {
    refuseUnlessTestTarget(await siteEnvironment(baseUrl), allTestData ? 'Loading every test data file' : 'Loading test participants');
  }

  const dataDir = dirname(fileURLToPath(import.meta.url));
  const names = allTestData ? allDataFiles(dataDir) : [values.file ?? 'golf-2026.json'];
  /** The file to load, or null for a real data file that a load-every-test-file run passes over. */
  const readFile = (name: string): SportDataFile | null => {
    const path = resolve(dataDir, name);
    const inside = relative(dataDir, path);
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error(`--file ${name} is outside ${dataDir}.`);
    const file = parseSportDataFile(JSON.parse(readFileSync(path, 'utf8')) as unknown, { allowTestData: values['allow-test-data'] });
    if (allTestData && (!file.testData || isTestSlate(file))) return null;
    if (withParticipants && (!file.testData || isTestSlate(file))) throw new Error(`--with-participants goes with a test data file, and ${name} is not one.`);
    return file;
  };

  let signedIn: { client: Client; at: number } | null = null;
  const getClient = async (): Promise<Client> => {
    if (signedIn && Date.now() - signedIn.at < SIGN_IN_AGAIN_AFTER_MS) return signedIn.client;
    const admin = await signIn(baseUrl, identifier, password);
    if (!admin.isRootAdmin) throw new Error(`${identifier} is not a root admin.`);
    signedIn = { client: admin.client, at: Date.now() };
    return admin.client;
  };
  const signInPlayer = async (player: string, playerPassword: string): Promise<Client> => (await signIn(baseUrl, player, playerPassword)).client;

  const reports: string[] = [];
  const failed: string[] = [];
  for (const name of names) {
    try {
      // Read inside the try, so a malformed file in a load-every-test-file run is listed as failed.
      const file = readFile(name);
      if (file === null) continue;
      console.log(`${mode === LoadMode.APPLY ? 'Loading' : 'Dry run of'} ${name} into ${baseUrl}.`);
      const rows = await loadSportData(file, {
        getClient,
        now: new Date(),
        mode,
        log: (line) => console.log(line),
        ...(values.event ? { event: values.event } : {}),
        replaceField: values['replace-field'],
      });
      if (withParticipants) {
        rows.push(...await loadTestParticipants(file, { getClient, signIn: signInPlayer, mode, log: (line) => console.log(line) }));
      }
      const report = formatLoadReport(file, mode, rows);
      console.log(report);
      reports.push(allTestData ? `## ${name}\n\n${report}` : report);
    } catch (error: unknown) {
      // One file's failure stops only that file when loading them all; a rerun fills it in.
      if (!allTestData) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`${name} failed: ${reason}`);
      failed.push(name);
      reports.push(`## ${name}\n\n### Load sport data failed\n\n\`\`\`\n${reason}\n\`\`\`\n`);
    }
  }
  if (values.report) writeFileSync(values.report, reports.join('\n'));
  if (failed.length > 0) throw new Error(`${failed.length} file${failed.length === 1 ? '' : 's'} failed: ${failed.join(', ')}. Run again to fill in the rest.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
