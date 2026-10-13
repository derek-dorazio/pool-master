/**
 * Loads a sport data file (sport-data-file.ts) into a running PoolMaster as a root admin.
 *
 * Usage:
 *   POOLMASTER_SEED_BASE_URL=http://localhost:3000 \
 *   POOLMASTER_SEED_ADMIN_IDENTIFIER=poolmaster-admin \
 *   POOLMASTER_SEED_ADMIN_PASSWORD=... \
 *   npm run seed:golf -- [--file golf-2026.json] [--mode dry-run|apply] [--allow-test-data] [--report report.md]
 *
 * --file is a path inside this folder (default golf-2026.json). --mode defaults to dry-run,
 * which reads the site and reports what applying would change without writing anything.
 * --allow-test-data lets a file with `testData: true` load; pass it only for a local or QA
 * site. --report also writes the run's markdown report to that path.
 *
 * The base URL is the site root that serves /api/v1 (the API itself locally, the site on QA).
 * QA runs this through the "Load sport data" workflow, never on deploy.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createClient, createConfig, type Client } from '@poolmaster/shared/generated/hey-api/client';
import { loginUser } from '@poolmaster/shared/generated/hey-api';
import { formatLoadReport, LoadMode } from './load-report';
import { loadSportData } from './seed-golf';
import { parseSportDataFile } from './sport-data-file';

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

async function main(): Promise<void> {
  const baseUrl = requireEnv('POOLMASTER_SEED_BASE_URL').replace(/\/$/, '');
  const identifier = requireEnv('POOLMASTER_SEED_ADMIN_IDENTIFIER');
  const password = requireEnv('POOLMASTER_SEED_ADMIN_PASSWORD');
  const { values } = parseArgs({
    options: {
      file: { type: 'string', default: 'golf-2026.json' },
      mode: { type: 'string', default: 'dry-run' },
      'allow-test-data': { type: 'boolean', default: false },
      report: { type: 'string' },
    },
  });
  const mode = values.mode === 'apply' ? LoadMode.APPLY : values.mode === 'dry-run' ? LoadMode.DRY_RUN : null;
  if (mode === null) throw new Error(`--mode is ${values.mode}; use dry-run or apply.`);
  const path = join(dirname(fileURLToPath(import.meta.url)), values.file);
  const file = parseSportDataFile(JSON.parse(readFileSync(path, 'utf8')) as unknown, { allowTestData: values['allow-test-data'] });

  let signedIn: { client: Client; at: number } | null = null;
  const getClient = async (): Promise<Client> => {
    if (signedIn && Date.now() - signedIn.at < SIGN_IN_AGAIN_AFTER_MS) return signedIn.client;
    const login = await loginUser({ client: createClient(createConfig({ baseUrl })), body: { identifier, password } });
    if (!login.data) {
      // Typed as always present, but hey-api leaves it undefined when the fetch itself throws.
      const status = (login.response as Response | undefined)?.status ?? 'none';
      throw new Error(`Sign-in as ${identifier} failed (HTTP ${status}).`);
    }
    if (!login.data.user.isRootAdmin) throw new Error(`${identifier} is not a root admin.`);
    const { accessToken } = login.data.tokens;
    const client = createClient(createConfig({ baseUrl }));
    client.interceptors.request.use((request: Request) => {
      request.headers.set('Authorization', `Bearer ${accessToken}`);
      return request;
    });
    signedIn = { client, at: Date.now() };
    return client;
  };

  console.log(`${mode === LoadMode.APPLY ? 'Loading' : 'Dry run of'} ${values.file} into ${baseUrl}.`);
  const rows = await loadSportData(file, { getClient, now: new Date(), mode, log: (line) => console.log(line) });
  const report = formatLoadReport(file, mode, rows);
  console.log(report);
  if (values.report) writeFileSync(values.report, report);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
