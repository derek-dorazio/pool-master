/**
 * One event from a sport's last-season test seed (`packages/core-api/scripts/seed-golf/*-test.json`),
 * for the SDK functional suites that run a contest on a real played event: tagged so each run
 * loads its own copy, moved into a season of its own, and optionally without its results, so a
 * suite can pick before each round and then enter that round's real results itself
 * (`placeSeedRound`, `enterSeedRound`), as the loader does.
 *
 * Scaffolding only: no assertions and no test-specific data here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  proposeEventRoundMatchups,
  recordEventMatchPeriodScore,
  recordEventMatchResult,
  setEventRoundMatchups,
} from '@poolmaster/shared/generated/hey-api';
import { MatchSide } from '@poolmaster/shared/domain';
import {
  parseSportDataFile,
  type SportDataEvent,
  type SportDataFile,
  type SportDataMatch,
} from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { expectDefined } from './expect-defined';

type Client = Parameters<typeof recordEventMatchResult>[0]['client'];

const SEED_DIR = join(__dirname, '../../packages/core-api/scripts/seed-golf');

/** A seed file's one event, as `oneEventOf` loads it. */
export type OneEventSeed = (tag: string, season: number) => SportDataFile;

/**
 * One sport league's one event from a test seed file, with only that event's players, every key
 * and the event's name tagged with `tag`, moved whole years into `season`. `withoutResults` drops
 * every match's result and period scores, so the event loads released and unplayed.
 */
export function oneEventOf(fileName: string, leagueName: string, eventName: string, options: { withoutResults?: boolean } = {}): OneEventSeed {
  return (tag, season) => {
    const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, fileName), 'utf8')) as unknown, { allowTestData: true });
    const league = expectDefined(file.sportLeagues.find((row) => row.name === leagueName), leagueName);
    const event = expectDefined(league.events.find((row) => row.name === eventName), eventName);
    const tagged = (key: string) => `${tag}-${key}`;
    const inField = new Set(event.field.flatMap((entry) => [entry.player, ...(entry.playInWinner === undefined ? [] : [entry.playInWinner])]));
    league.players = league.players.filter((player) => inField.has(player.key)).map((player) => ({ ...player, key: tagged(player.key) }));
    event.name = `${event.name} ${tag}`;
    for (const entry of event.field) {
      entry.player = tagged(entry.player);
      if (entry.playInWinner !== undefined) entry.playInWinner = tagged(entry.playInWinner);
    }
    for (const match of event.matches ?? []) {
      match.home = match.home === null ? null : tagged(match.home);
      match.away = match.away === null ? null : tagged(match.away);
      if (options.withoutResults === true) {
        delete match.result;
        delete match.periodScores;
      }
    }
    league.events = [event];
    file.sportLeagues = [league];
    file.scope.sportLeagues = [league.name];
    return inSeason(file, season);
  };
}

/**
 * The file moved whole years into `season`: every date and time of its events shifted by the same
 * number of years, so each event keeps its own calendar, and parsed again so the loader's checks
 * still hold.
 */
export function inSeason(file: SportDataFile, season: number): SportDataFile {
  const years = season - file.scope.season;
  const sportLeagues = JSON.stringify(file.sportLeagues)
    .replace(/"(\d{4})-(\d{2}-\d{2})/g, (_match, year: string, rest: string) => `"${Number(year) + years}-${rest}`);
  return parseSportDataFile({ ...file, scope: { ...file.scope, season }, sportLeagues: JSON.parse(sportLeagues) as unknown }, { allowTestData: true });
}

/** The seed file's event as it was played, results included: what `placeSeedRound` and `enterSeedRound` read. */
export function playedSeedEvent(fileName: string, leagueName: string, eventName: string): SportDataEvent {
  const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, fileName), 'utf8')) as unknown, { allowTestData: true });
  const league = expectDefined(file.sportLeagues.find((row) => row.name === leagueName), leagueName);
  return expectDefined(league.events.find((row) => row.name === eventName), eventName);
}

/**
 * Places one round's teams where the results do not: a round whose sides wait on no link (a
 * reseeded round) takes the server's proposed pairing, the rule a real reseed follows. Call it
 * once the round before is played, before the round is picked.
 */
export async function placeSeedRound(client: Client, eventId: string, played: SportDataEvent, roundNumber: number): Promise<void> {
  const matches = played.matches ?? [];
  const linked = new Set(matches.flatMap((match) => (match.advancesTo ? [`${match.advancesTo.matchNumber}/${match.advancesTo.side}`] : [])));
  if (!matches.some((match) => match.roundNumber === roundNumber && waitsOnReseed(match, linked))) return;
  const proposal = expectDefined((await proposeEventRoundMatchups({ client, path: { eventId, roundNumber } })).data, `round ${roundNumber}'s proposal`);
  await setEventRoundMatchups({ client, path: { eventId, roundNumber }, body: { matches: proposal.matches } });
}

/**
 * Enters one round's real results on the loaded event, as the loader does, once the round is
 * placed (`placeSeedRound`): each match takes its period scores and its result, the winner named
 * as the side the match stands on.
 */
export async function enterSeedRound(client: Client, eventId: string, played: SportDataEvent, roundNumber: number): Promise<void> {
  for (const match of (played.matches ?? []).filter((candidate) => candidate.roundNumber === roundNumber)) {
    const result = expectDefined(match.result, `match ${match.matchNumber}'s result`);
    for (const { periodNumber, ...score } of match.periodScores ?? []) {
      await recordEventMatchPeriodScore({ client, path: { eventId, matchNumber: match.matchNumber, periodNumber }, body: score });
    }
    await recordEventMatchResult({
      client,
      path: { eventId, matchNumber: match.matchNumber },
      body: { winnerSide: result.winner, homeScore: result.homeScore, awayScore: result.awayScore },
    });
  }
}

function waitsOnReseed(match: SportDataMatch, linked: ReadonlySet<string>): boolean {
  return (match.home === null && !linked.has(`${match.matchNumber}/${MatchSide.HOME}`))
    || (match.away === null && !linked.has(`${match.matchNumber}/${MatchSide.AWAY}`));
}
