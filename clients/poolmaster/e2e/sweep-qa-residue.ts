import { appendFileSync } from 'node:fs';
import { request } from '@playwright/test';
import { adminApiHeaders } from './helpers/admin-api';
import { readAdminCredentials } from './helpers/admin-session';
import { assertSweepableBaseUrl, describeSweepReport, sweepE2eResidue } from './helpers/residue-sweep';

/**
 * #1401 — removes e2e runs' leftovers from QA (or a local stack): `npm run e2e:sweep-residue
 * --workspace @poolmaster/poolmaster`, which the nightly "Sweep QA e2e residue" workflow runs.
 *
 * - `POOLMASTER_E2E_BASE_URL`: the site, QA unless set; anything but QA or localhost is refused.
 * - `POOLMASTER_E2E_ADMIN_IDENTIFIER` / `POOLMASTER_E2E_ADMIN_PASSWORD`: the e2e root admin.
 * - `SWEEP_MIN_AGE_HOURS`: leave runs younger than this alone (2 unless set), so a live run is
 *   never raced.
 *
 * Writes the report to the GitHub step summary when there is one, and exits non-zero when any
 * removal failed, so the workflow run shows red.
 */

const DEFAULT_BASE_URL = 'https://qa.ultimateofficepoolmanager.com';
const DEFAULT_MIN_AGE_HOURS = 2;
const HOUR_MS = 60 * 60 * 1000;

function readMinAgeHours(): number {
  const raw = process.env['SWEEP_MIN_AGE_HOURS'];
  if (raw === undefined || raw === '') return DEFAULT_MIN_AGE_HOURS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`SWEEP_MIN_AGE_HOURS must be a number of hours, 0 or more, not "${raw}".`);
  }
  return hours;
}

async function main(): Promise<number> {
  const baseUrl = process.env['POOLMASTER_E2E_BASE_URL'] || DEFAULT_BASE_URL;
  assertSweepableBaseUrl(baseUrl);
  const minAgeHours = readMinAgeHours();
  const credentials = readAdminCredentials();
  const log = (message: string) => console.log(`[sweep] ${message}`);
  const api = await request.newContext({ baseURL: baseUrl });
  try {
    const headers = await adminApiHeaders(api, credentials);
    if (!headers) {
      console.error('[sweep] admin login failed; nothing removed');
      return 1;
    }
    log(`sweeping ${baseUrl} for e2e runs older than ${minAgeHours} hour(s)`);
    const report = await sweepE2eResidue(api, headers, { minAgeMs: minAgeHours * HOUR_MS, log });
    const summary = describeSweepReport(report, baseUrl);
    console.log(summary);
    const stepSummary = process.env['GITHUB_STEP_SUMMARY'];
    if (stepSummary) appendFileSync(stepSummary, summary);
    return report.failures.length === 0 ? 0 : 1;
  } finally {
    await api.dispose();
  }
}

main().then((code) => {
  process.exitCode = code;
}, (error: unknown) => {
  console.error('[sweep] failed:', error);
  process.exitCode = 1;
});
