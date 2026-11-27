/**
 * Checks BALLDONTLIE's real API against what PoolMaster's adapter was built from (#1495).
 *
 *   npm run balldontlie:contract-check -- [--tournament <id>] [--game-event <scope>] [--update-spec]
 *
 * 1. Downloads the vendor's published document for each league the adapter reads (PGA TOUR, NFL,
 *    NCAAF, NCAAB, NCAAW, NBA, EPL and FIFA) and compares it with the vendored copy the contract tests run against
 *    (tests/fixtures/balldontlie/openapi/<league>.yml). A difference fails the check;
 *    `--update-spec` writes the new copy instead, and the contract tests then say whether
 *    anything the adapter reads moved.
 * 2. With BALLDONTLIE_API_KEY set, runs the adapter itself against the live API: the health
 *    read, this season's tournaments, NFL events and College Football Playoffs, NCAA men's and women's tournaments and the NBA playoffs, Premier
 *    League matchweeks and the World Cup's knockout bracket, every NFL, college football, NBA and Division I basketball team, men's and women's, the Premier
 *    League's teams, the World Cup's nations, for `--tournament` (a finished stroke-play tournament is
 *    best) its field and its scores, and for `--game-event` (`nfl-2025-postseason`,
 *    `ncaaf-2025-cfp`, `ncaab-2025-tournament`, `ncaaw-2025-tournament`, `nba-2025-postseason`, `nhl-2024-postseason`, `mlb-2025-postseason`, `wnba-2025-postseason`, `epl-2026-matchweek-11` or `fifa-wc-2026-knockout`, say) its teams and its game scores. Every response is parsed with
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
const LEAGUES = { pga: 'PGA TOUR', nfl: 'NFL', ncaaf: 'NCAAF', ncaab: 'NCAAB', ncaaw: 'NCAAW', nba: 'NBA', nhl: 'NHL', mlb: 'MLB', wnba: 'WNBA', epl: 'EPL', fifa: 'FIFA', f1: 'Formula 1' } as const;
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

/**
 * The leagues the live check reads: every league the seeded BALLDONTLIE Provider rows list. The
 * check runs without a database, so it names them here; a league the migration adds is added too.
 */
const BALLDONTLIE_CONTRACT_CHECK_LEAGUES = [
  { code: 'pga', sport: Sport.GOLF, name: 'PGA TOUR' },
  { code: 'nfl', sport: Sport.FOOTBALL, name: 'NFL' },
  { code: 'ncaaf', sport: Sport.FOOTBALL, name: 'College Football' },
  { code: 'nba', sport: Sport.BASKETBALL, name: 'NBA' },
  { code: 'ncaab', sport: Sport.BASKETBALL, name: 'NCAA Men\'s Basketball' },
  { code: 'ncaaw', sport: Sport.BASKETBALL, name: 'NCAA Women\'s Basketball' },
  { code: 'wnba', sport: Sport.BASKETBALL, name: 'WNBA' },
  { code: 'nhl', sport: Sport.HOCKEY, name: 'NHL' },
  { code: 'mlb', sport: Sport.BASEBALL, name: 'MLB' },
  { code: 'epl', sport: Sport.SOCCER, name: 'Premier League' },
  { code: 'worldcup', sport: Sport.SOCCER, name: 'FIFA World Cup' },
] as const;

async function checkLiveApi(apiKey: string): Promise<boolean> {
  const adapter = new BalldontlieAdapter({
    connection: () => ({ baseUrl: 'https://api.balldontlie.io', requestsPerMinute: Number(values['requests-per-minute']) }),
    apiKey,
    // Every league the adapter reads, as the seeded Provider rows list them.
    leagues: BALLDONTLIE_CONTRACT_CHECK_LEAGUES,
  });
  const year = new Date().getUTCFullYear();
  const thisYear = { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year, 11, 31)) };
  // One events read per league, by its code (#2005), and one participants read per sport.
  const sports = [...new Set(BALLDONTLIE_CONTRACT_CHECK_LEAGUES.map((league) => league.sport))];
  const checks: Array<[string, () => Promise<string>]> = [
    ...BALLDONTLIE_CONTRACT_CHECK_LEAGUES.map((league): [string, () => Promise<string>] => [
      `${league.name} events this year`,
      async () => `${String((await adapter.getUpcomingEvents(league.sport, thisYear, { providerLeagueCode: league.code })).length)} events`,
    ]),
    ...sports.map((sport): [string, () => Promise<string>] => [
      `${sport} participants`,
      async () => `${String((await adapter.getParticipants(sport)).length)} participants`,
    ]),
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
