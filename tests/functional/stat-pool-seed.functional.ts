import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listEventParticipants, listEvents, listSportLeagues } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode, LoadSubject } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// A championship stat pool's test seed end to end over HTTP (#935): the 2025 World Series as
// played loads into the World Series league the migrations create, its field of position players
// tiered by ranking, every game's real box score written through the stat lines API, and the
// event released.

const RUN = `stat-pool-seed-${Date.now()}`;
const SEED_DIR = join(__dirname, '../../packages/core-api/scripts/seed-golf');

const created = { sportLeagueIds: new Set<string>() };

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const leagueIds = [...created.sportLeagueIds];
  if (leagueIds.length) {
    const series = { eventSeries: { sportLeagueId: { in: leagueIds } } };
    const where = { sportEvent: series };
    await db.sportEventParticipantStatLine.deleteMany({ where: { participantRound: { sportEventParticipant: where } } });
    await db.sportEventParticipantRound.deleteMany({ where: { sportEventParticipant: where } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: where } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: where } });
    await db.sportEventParticipant.deleteMany({ where });
    await db.sportEventRound.deleteMany({ where });
    await db.sportEventTier.deleteMany({ where });
    await db.sportEvent.deleteMany({ where: series });
    await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
  }
  const participantIds = (await db.participant.findMany({ where: { externalId: { startsWith: RUN } }, select: { id: true } })).map((row) => row.id);
  await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
}

afterAll(async () => {
  await cleanupFunctionalData();
  await cleanup();
  await disconnectFunctionalPrisma();
});

/** The seed with its players tagged with this run, so they never meet another suite's. */
function taggedSeed(fileName: string): SportDataFile {
  const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, fileName), 'utf8')) as unknown, { allowTestData: true });
  for (const league of file.sportLeagues) {
    for (const player of league.players) {
      player.key = `${RUN}-${player.key}`;
      player.name = `${player.name} ${RUN}`;
    }
    for (const event of league.events) {
      for (const entry of event.field) entry.player = `${RUN}-${entry.player}`;
      for (const game of event.games ?? []) for (const line of game.lines) line.player = `${RUN}-${line.player}`;
    }
  }
  return file;
}

/** The seeded stat pool league of the sport by name, cleared of any earlier run's events. */
async function seededLeague(client: Client, sport: Sport, name: string): Promise<string> {
  const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client, query: { sport } })).data).sportLeagues
    .find((league) => league.name === name));
  created.sportLeagueIds.add(sportLeague.id);
  await cleanup();
  return sportLeague.id;
}

describe('SDK Functional: stat pool test seed', () => {
  it('loads the 2025 World Series as played, every game\'s box score stored and the event released, and a second run changes nothing', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Stat Pool Secretary' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const file = taggedSeed('baseball-2025-world-series-test.json');
    const sportLeagueId = await seededLeague(a, Sport.BASEBALL, 'World Series');

    const rows = await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY });
    expect(rows.filter((row) => row.subject === LoadSubject.STATS).map((row) => row.action)).toEqual([LoadAction.ADD]);

    const [event] = expectDefined((await listEvents({ client: a, query: { sportLeagueId } })).data).events;
    expect([event.name, event.status, event.rounds, event.scoringFamily, event.participantType]).toEqual(['World Series', 'SCHEDULED', 7, 'COMPOSITE', 'INDIVIDUAL']);

    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: event.id } })).data).participants;
    expect(field).toHaveLength(28);
    expect(field.every((row) => row.valuation?.sportEventTierId)).toBe(true);
    const ohtani = expectDefined(field.find((row) => row.participant.externalId === `${RUN}-mlb-shohei-ohtani`));
    expect([ohtani.participant.teamAffiliation, ohtani.participant.role]).toEqual(['Los Angeles Dodgers', 'TWP']);
    const gameLines = (game: number) => field.flatMap((row) => row.rounds.filter((round) => round.roundNumber === game && round.statLines.length > 0));
    expect([1, 2, 3, 4, 5, 6, 7].map((game) => gameLines(game).length)).toEqual(
      expectDefined(file.sportLeagues[0].events[0].games).map((game) => game.lines.filter((line) => Object.keys(line.stats).length > 0).length),
    );
    // Game 3, the 18-inning game: Ohtani's two homers and two doubles, and five walks.
    expect(ohtani.rounds.find((round) => round.roundNumber === 3)?.statLines).toEqual(
      Object.entries(expectDefined(file.sportLeagues[0].events[0].games?.[2].lines.find((line) => line.player === `${RUN}-mlb-shohei-ohtani`)).stats)
        .map(([stat, value]) => ({ stat, value })),
    );

    const again = await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.DRY_RUN });
    expect(again.filter((row) => row.action !== LoadAction.SKIP)).toEqual([]);
  });

  it('stores a run for a loss as negative rushing yards: Super Bowl LX\'s line for Rashid Shaheed', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Stat Pool Secretary' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const file = taggedSeed('american-football-2026-nfl-championships-test.json');
    await seededLeague(a, Sport.AMERICAN_FOOTBALL, 'Championship Weekend');
    const sportLeagueId = await seededLeague(a, Sport.AMERICAN_FOOTBALL, 'Super Bowl');

    await loadSportData(file, { getClient: () => Promise.resolve(a), now: new Date(), mode: LoadMode.APPLY });

    const [event] = expectDefined((await listEvents({ client: a, query: { sportLeagueId } })).data).events;
    const field = expectDefined((await listEventParticipants({ client: a, path: { eventId: event.id } })).data).participants;
    const shaheed = expectDefined(field.find((row) => row.participant.externalId === `${RUN}-nfl-rashid-shaheed`));
    expect(shaheed.rounds.find((round) => round.roundNumber === 1)?.statLines).toEqual([
      { stat: 'RECEPTIONS', value: 2 }, { stat: 'RUSHING_YARDS', value: -5 }, { stat: 'RECEIVING_YARDS', value: 27 },
    ]);
  });
});
