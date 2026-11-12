/**
 * Checks BALLDONTLIE's real API against what PoolMaster's adapter was built from (#1495).
 *
 *   npm run balldontlie:contract-check -- [--tournament <id>] [--game-event <scope>] [--update-spec]
 *
 * 1. Downloads the vendor's published document for each league the adapter reads (PGA TOUR, NFL,
 *    NCAAB, NCAAW, NBA, EPL and FIFA) and compares it with the vendored copy the contract tests run against
 *    (tests/fixtures/balldontlie/openapi/<league>.yml). A difference fails the check;
 *    `--update-spec` writes the new copy instead, and the contract tests then say whether
 *    anything the adapter reads moved.
 * 2. With BALLDONTLIE_API_KEY set, runs the adapter itself against the live API: the health
 *    read, this season's tournaments, NFL events, NCAA men's and women's tournaments and the NBA playoffs, Premier
 *    League matchweeks and the World Cup's knockout bracket, every NFL, NBA and Division I basketball team, men's and women's, the Premier
 *    League's teams, the World Cup's nations, for `--tournament` (a finished stroke-play tournament is
 *    best) its field and its scores, and for `--game-event` (`nfl-2025-postseason`,
 *    `ncaab-2025-tournament`, `ncaaw-2025-tournament`, `nba-2025-postseason`, `wnba-2025-postseason`, `epl-2026-matchweek-11` or `fifa-wc-2026-knockout`, say) its teams and its game scores. Every response is parsed with
 *    the same schemas a sync uses, so a field that drifted fails here with the path that broke.
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

/** Each league the adapter reads, by the name of its vendored document, with the name the vendor gives it. */
const LEAGUES = { pga: 'PGA TOUR', nfl: 'NFL', ncaab: 'NCAAB', ncaaw: 'NCAAW', nba: 'NBA', wnba: 'WNBA', epl: 'EPL', fifa: 'FIFA' } as const;
type League = keyof typeof LEAGUES;
const HEADER_LINES = 3;

const specUrl = (league: League) => `https://www.balldontlie.io/openapi/${league}.yml`;
const vendoredSpec = (league: League) => resolve(import.meta.dirname, `../../../tests/fixtures/balldontlie/openapi/${league}.yml`);

const { values } = parseArgs({
  options: {
    tournament: { type: 'string' },
    'game-event': { type: 'string' },
    'update-spec': { type: 'boolean', default: false },
    'requests-per-minute': { type: 'string', default: '5' },
  },
});

function header(league: League, sha256: string): string {
  return [
    `# Vendored copy of BALLDONTLIE's published ${LEAGUES[league]} OpenAPI document, unchanged below this header.`,
    `# Source: ${specUrl(league)}, fetched ${new Date().toISOString().slice(0, 10)} (sha256 ${sha256}).`,
    '# The contract tests hold the adapter to it. Refresh it with `npm run balldontlie:contract-check -- --update-spec`.',
  ].join('\n');
}

async function checkSpec(league: League): Promise<boolean> {
  const url = specUrl(league);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
  const live = await response.text();
  const vendored = readFileSync(vendoredSpec(league), 'utf8').split('\n').slice(HEADER_LINES).join('\n');
  const name = `${LEAGUES[league]} vendor document`;
  if (live === vendored) {
    console.log(`${name}: unchanged since it was vendored.`);
    return true;
  }
  if (values['update-spec']) {
    const sha256 = createHash('sha256').update(live).digest('hex');
    writeFileSync(vendoredSpec(league), `${header(league, sha256)}\n${live}`);
    console.log(`${name}: CHANGED. Wrote the new copy; run the BALLDONTLIE contract tests next.`);
    return true;
  }
  console.log(`${name}: CHANGED since it was vendored. Re-run with --update-spec, then run the contract tests.`);
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
    ['this season\'s NFL events', async () => `${String((await adapter.getUpcomingEvents(Sport.AMERICAN_FOOTBALL)).length)} weeks and postseasons`],
    ['NFL teams', async () => `${String((await adapter.getParticipants(Sport.AMERICAN_FOOTBALL)).length)} teams`],
    ['the last and next NCAA men\'s and women\'s tournaments and NBA and WNBA playoffs', async () => `${String((await adapter.getUpcomingEvents(Sport.BASKETBALL)).length)} tournaments and playoffs`],
    ['NBA, WNBA and Division I basketball teams, men\'s and women\'s', async () => `${String((await adapter.getParticipants(Sport.BASKETBALL)).length)} teams`],
    ['Premier League matchweeks and the current World Cup bracket', async () => `${String((await adapter.getUpcomingEvents(Sport.SOCCER)).length)} events`],
    ['Premier League teams and World Cup nations', async () => `${String((await adapter.getParticipants(Sport.SOCCER)).length)} teams`],
  ];
  const tournamentId = values.tournament;
  if (tournamentId) {
    checks.push(
      [`tournament ${tournamentId} field`, async () => `${String((await adapter.getEventDetails(tournamentId))?.participants.length ?? 'no tournament')} golfers`],
      [`tournament ${tournamentId} scores`, async () => `${String(countLiveScoreUpdates(await adapter.getLiveScores(tournamentId)))} round updates`],
    );
  }

  const gameEvent = values['game-event'];
  if (gameEvent) {
    checks.push(
      [`${gameEvent} teams`, async () => `${String((await adapter.getEventDetails(gameEvent))?.participants.length ?? 'no games')} teams`],
      [`${gameEvent} scores`, async () => `${String(countLiveScoreUpdates(await adapter.getLiveScores(gameEvent)))} games`],
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
  let specOk = true;
  for (const league of Object.keys(LEAGUES) as League[]) {
    specOk = await checkSpec(league) && specOk;
  }
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
