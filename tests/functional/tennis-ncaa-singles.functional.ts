import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getEventBracket,
  listContestConfigTemplates,
  listEventParticipants,
  listEvents,
  listSportLeagues,
} from '@poolmaster/shared/generated/hey-api';
import { Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode } from '../../packages/core-api/scripts/seed-golf/load-report';
import { loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { parseSportDataFile, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildRegisteredUser, promoteToRootAdmin, type RegisteredUserContext } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';

// The 2025 NCAA Division I men's and women's singles championships over HTTP (#704 slice 4): the
// test seed loads each 64-player draw into its NCAA sport league, six rounds named as the NCAA
// names them, and plays every match out, the women's Round of 16 walkover included. Each league
// offers its own setups, doubling from 1 to 32 in the final.

const RUN = `tennis-ncaa-${Date.now()}`;
const SEED_DIR = join(__dirname, '../../packages/core-api/scripts/seed-golf');

const created = { sportEventIds: new Set<string>() };

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = [...created.sportEventIds];
  if (eventIds.length) {
    const seriesIds = (await db.sportEvent.findMany({ where: { id: { in: eventIds } }, select: { eventSeriesId: true } }))
      .map((event) => event.eventSeriesId);
    await db.sportEventMatch.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipant: { sportEventId: { in: eventIds } } } });
    await db.sportEventParticipant.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
    await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.eventSeries.deleteMany({ where: { id: { in: seriesIds } } });
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

/** The test seed, its players and events tagged with this run so they never meet another suite's. */
function taggedSeed(fileName: string, eventName: (leagueName: string) => string): SportDataFile {
  const file = parseSportDataFile(JSON.parse(readFileSync(join(SEED_DIR, fileName), 'utf8')) as unknown, { allowTestData: true });
  const tagged = (key: string | null) => (key === null ? null : `${RUN}-${key}`);
  for (const league of file.sportLeagues) {
    const [draw] = league.events;
    draw.name = eventName(league.name);
    for (const player of league.players) player.key = expectDefined(tagged(player.key));
    for (const entry of draw.field) {
      entry.player = expectDefined(tagged(entry.player));
      if (entry.playInWinner !== undefined) entry.playInWinner = expectDefined(tagged(entry.playInWinner));
    }
    for (const match of draw.matches ?? []) Object.assign(match, { home: tagged(match.home), away: tagged(match.away) });
  }
  return file;
}

/** Loads a seed dated from today (release refuses an event that has started). */
async function loadSeed(admin: RegisteredUserContext, file: SportDataFile): Promise<void> {
  await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.APPLY });
}

/** One of a loaded seed's sport leagues and its event. */
async function findDraw(admin: RegisteredUserContext, file: SportDataFile, leagueIndex = 0) {
  const leagueName = file.sportLeagues[leagueIndex].name;
  const sportLeague = expectDefined(expectDefined((await listSportLeagues({ client: admin.client, query: { sport: Sport.TENNIS } })).data).sportLeagues
    .find((league) => league.name === leagueName), leagueName);
  const eventName = file.sportLeagues[leagueIndex].events[0].name;
  const event = expectDefined(expectDefined((await listEvents({ client: admin.client, query: { sportLeagueId: sportLeague.id } })).data).events
    .find((row) => row.name === eventName), eventName);
  created.sportEventIds.add(event.id);
  return { sportLeague, event };
}

describe('SDK Functional: the 2025 NCAA singles championships', () => {
  beforeAll(async () => {
    // The migration's reference row, restored in case an earlier suite cleared the sports table.
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.TENNIS },
      create: { sport: Sport.TENNIS, participantType: 'INDIVIDUAL', tournamentFormat: 'MATCHES' },
      update: {},
    });
  });

  it('loads both 64-player draws in six NCAA-named rounds, 16 seeds with the 9-16 group sharing seed 9, every match played, Zheng and Brantmeier the champions, and a reload changes nothing', async () => {
    const admin = await buildRegisteredUser({ displayName: 'College Tennis Director' });
    await promoteToRootAdmin(admin);
    const file = taggedSeed('tennis-2025-ncaa-singles-test.json', (leagueName) => `${leagueName} singles ${RUN}`);
    await loadSeed(admin, file);

    for (const [leagueIndex, champion, runnerUp, finalScore] of [
      [0, 'Michael Zheng', 'Trevor Svajda', [2, 1]],
      [1, 'Reese Brantmeier', 'Berta Passola Folch', [2, 0]],
    ] as const) {
      const { sportLeague, event } = await findDraw(admin, file, leagueIndex);
      expect(sportLeague.roundNames).toEqual(['First Round', 'Second Round', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final']);
      expect([event.status, event.rounds]).toEqual(['SCHEDULED', 6]);
      const field = expectDefined((await listEventParticipants({ client: admin.client, path: { eventId: event.id } })).data).participants;
      expect(field).toHaveLength(64);
      expect(field.map((row) => row.seedNumber).filter((seed) => seed !== null).sort((left, right) => left - right))
        .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9, 9, 9, 9, 9]);

      const bracket = expectDefined((await getEventBracket({ client: admin.client, path: { eventId: event.id } })).data).matches;
      expect(bracket).toHaveLength(63);
      expect(bracket.every((match) => match.status === 'COMPLETED')).toBe(true);
      // Each quarter of the draw is a region through the quarterfinals; the semifinals and final carry none.
      expect([...new Set(bracket.filter((match) => match.roundNumber <= 4).map((match) => match.regionLabel))])
        .toEqual(['Top quarter', 'Second quarter', 'Third quarter', 'Bottom quarter']);
      expect(bracket.filter((match) => match.roundNumber > 4).map((match) => match.regionLabel)).toEqual([null, null, null]);
      const final = expectDefined(bracket.find((match) => match.roundNumber === 6));
      const nameOf = (rowId: string | null) => expectDefined(field.find((row) => row.id === rowId)).participant.name;
      const [winnerRow, loserRow, winnerSets, loserSets] = final.winnerSide === 'HOME'
        ? [final.homeSportEventParticipantId, final.awaySportEventParticipantId, final.homeScore, final.awayScore]
        : [final.awaySportEventParticipantId, final.homeSportEventParticipantId, final.awayScore, final.homeScore];
      expect([nameOf(winnerRow), nameOf(loserRow), winnerSets, loserSets]).toEqual([champion, runnerUp, ...finalScore]);

      const templates = expectDefined((await listContestConfigTemplates({
        client: admin.client,
        query: { sport: Sport.TENNIS, sportLeagueId: sportLeague.id, active: true },
      })).data).templates;
      expect(templates.filter((template) => template.isDefault)).toHaveLength(5);
    }

    // The women's Round of 16 walkover: Welker through without a ball struck, so no score.
    const { event: women } = await findDraw(admin, file, 1);
    const womenBracket = expectDefined((await getEventBracket({ client: admin.client, path: { eventId: women.id } })).data).matches;
    expect(womenBracket.filter((match) => match.ending !== 'PLAYED').map((match) => [match.roundNumber, match.ending, match.homeScore, match.awayScore]))
      .toEqual([[3, 'WALKOVER', null, null]]);

    const again = await loadSportData(file, { getClient: () => Promise.resolve(admin.client), now: new Date(), mode: LoadMode.DRY_RUN });
    expect(again.filter((row) => row.action !== LoadAction.SKIP)).toEqual([]);
  });
});
