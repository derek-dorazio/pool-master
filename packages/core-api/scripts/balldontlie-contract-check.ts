/**
 * Checks BALLDONTLIE's real API against what PoolMaster's adapter was built from (#1495).
 *
 *   npm run balldontlie:contract-check -- [--tournament <id>] [--update-spec]
 *
 * 1. Downloads the vendor's published PGA document and compares it with the vendored copy the
 *    contract tests run against (tests/fixtures/balldontlie/openapi/pga.yml). A difference fails
 *    the check; `--update-spec` writes the new copy instead, and the contract tests then say
 *    whether anything the adapter reads moved.
 * 2. With BALLDONTLIE_API_KEY set, runs the adapter itself against the live API: the health
 *    read, this season's tournaments, and for `--tournament` (a finished stroke-play tournament
 *    is best) its field and its scores. Every response is parsed with the same schemas a sync
 *    uses, so a field that drifted fails here with the path that broke.
 *
 * Read-only against the vendor. It needs a network that reaches www.balldontlie.io and
 * api.balldontlie.io, which agent containers may not have.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Sport } from '@poolmaster/shared/domain';
import { BalldontlieAdapter } from '../src/modules/ingestion/adapters/balldontlie/balldontlie-adapter';
import { BalldontlieContractError } from '../src/modules/ingestion/adapters/balldontlie/balldontlie-client';
import { countLiveScoreUpdates } from '../src/modules/ingestion/core/live-score-count';
import { errorMessageWithCause } from '../src/core/error-message';

const SPEC_URL = 'https://www.balldontlie.io/openapi/pga.yml';
const VENDORED_SPEC = resolve(import.meta.dirname, '../../../tests/fixtures/balldontlie/openapi/pga.yml');
const HEADER_LINES = 3;

const { values } = parseArgs({
  options: {
    tournament: { type: 'string' },
    'update-spec': { type: 'boolean', default: false },
    'requests-per-minute': { type: 'string', default: '5' },
  },
});

function header(sha256: string): string {
  return [
    '# Vendored copy of BALLDONTLIE\'s published PGA TOUR OpenAPI document, unchanged below this header.',
    `# Source: ${SPEC_URL}, fetched ${new Date().toISOString().slice(0, 10)} (sha256 ${sha256}).`,
    '# The contract tests hold the adapter to it. Refresh it with `npm run balldontlie:contract-check -- --update-spec`.',
  ].join('\n');
}

async function checkSpec(): Promise<boolean> {
  const response = await fetch(SPEC_URL);
  if (!response.ok) throw new Error(`${SPEC_URL} answered ${String(response.status)}`);
  const live = await response.text();
  const vendored = readFileSync(VENDORED_SPEC, 'utf8').split('\n').slice(HEADER_LINES).join('\n');
  if (live === vendored) {
    console.log('Vendor document: unchanged since it was vendored.');
    return true;
  }
  if (values['update-spec']) {
    const sha256 = createHash('sha256').update(live).digest('hex');
    writeFileSync(VENDORED_SPEC, `${header(sha256)}\n${live}`);
    console.log('Vendor document: CHANGED. Wrote the new copy; run the BALLDONTLIE contract tests next.');
    return true;
  }
  console.log('Vendor document: CHANGED since it was vendored. Re-run with --update-spec, then run the contract tests.');
  return false;
}

async function checkLiveApi(apiKey: string): Promise<boolean> {
  const adapter = new BalldontlieAdapter({
    baseUrl: 'https://api.balldontlie.io',
    apiKey,
    requestsPerMinute: Number(values['requests-per-minute']),
  });
  const checks: Array<[string, () => Promise<string>]> = [
    ['health', async () => {
      const health = await adapter.healthCheck();
      if (health.status !== 'HEALTHY') throw new Error(health.message ?? health.status);
      return 'HEALTHY';
    }],
    ['this season\'s tournaments', async () => {
      const year = new Date().getUTCFullYear();
      const events = await adapter.getUpcomingEvents(Sport.GOLF, { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31)) });
      return `${String(events.length)} tournaments`;
    }],
  ];
  const tournamentId = values.tournament;
  if (tournamentId) {
    checks.push(
      [`tournament ${tournamentId} field`, async () => `${String((await adapter.getEventDetails(tournamentId))?.participants.length ?? 'no tournament')} golfers`],
      [`tournament ${tournamentId} scores`, async () => `${String(countLiveScoreUpdates(await adapter.getLiveScores(tournamentId)))} round updates`],
    );
  }

  let passed = true;
  for (const [name, check] of checks) {
    try {
      console.log(`PASS ${name}: ${await check()}`);
    } catch (error) {
      passed = false;
      if (error instanceof BalldontlieContractError) {
        console.log(`DRIFT ${name}: ${error.path}\n  ${error.issues.join('\n  ')}`);
      } else {
        console.log(`FAIL ${name}: ${errorMessageWithCause(error)}`);
      }
    }
  }
  return passed;
}

async function main(): Promise<void> {
  const specOk = await checkSpec();
  const apiKey = process.env['BALLDONTLIE_API_KEY']?.trim();
  let apiOk = true;
  if (apiKey) {
    apiOk = await checkLiveApi(apiKey);
  } else {
    console.log('BALLDONTLIE_API_KEY is not set: skipped the live API checks.');
  }
  process.exitCode = specOk && apiOk ? 0 : 1;
}

void main();
