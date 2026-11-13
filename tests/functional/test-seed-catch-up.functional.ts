import { getEventBracket, listEvents, listSportLeagues } from '@poolmaster/shared/generated/hey-api';
import { MatchStatus, Sport } from '@poolmaster/shared/domain';
import { LoadAction, LoadMode, LoadSubject } from '../../packages/core-api/scripts/seed-golf/load-report';
import { catchUpTestEvents, loadSportData } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import { TEST_EVENT_NAME_PREFIX, type SportDataFile } from '../../packages/core-api/scripts/seed-golf/sport-data-file';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { oneEventOf } from '../support/sport-test-seed';

// A test seed's results go in as its games are played (#1720): the load leaves every game still to
// kick off open, so a squares board or a pick can still be made on it, and a later run catches the
// event up, entering the games played since and moving it to In Progress, then to Completed once
// its last result is in.

const RUN = `catch-up-${Date.now()}`;
const MINUTE_MS = 60 * 1000;
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

/** The file as a test seed run loads it: its event named "Test- ...", as selectTestSeedEvents names it. */
function asLoaded(file: SportDataFile): SportDataFile {
  const [league] = file.sportLeagues;
  return { ...file, sportLeagues: [{ ...league, events: league.events.map((event) => ({ ...event, name: `${TEST_EVENT_NAME_PREFIX}${event.name}` })) }] };
}

describe('SDK Functional: a test seed\'s results as its games are played', () => {
  it('loads the NFL playoffs with no game played, then a later run enters the games played since and moves the event to In Progress, and to Completed once the Super Bowl is in', async () => {
    await getFunctionalPrisma().sport.upsert({
      where: { sport: Sport.AMERICAN_FOOTBALL },
      create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
      update: {},
    });
    const admin = await buildRegisteredUser({ displayName: 'Catch-up Loader' });
    await promoteToRootAdmin(admin);
    const a = admin.client;
    const getClient = () => Promise.resolve(a);

    const file = oneEventOf('american-football-2026-nfl-playoffs-test.json', 'NFL', 'NFL Playoffs')(RUN, 2026);
    const loaded = asLoaded(file);
    const eventName = loaded.sportLeagues[0].events[0].name;
    // Release refuses an event that has started by the server's clock, so the seed is dated from today.
    await loadSportData(loaded, { getClient, now: new Date(), mode: LoadMode.APPLY });

    const nfl = expectDefined(expectDefined((await listSportLeagues({ client: a, query: { sport: Sport.AMERICAN_FOOTBALL } })).data).sportLeagues
      .find((league) => league.name === 'NFL'));
    const readEvent = async () => expectDefined(expectDefined((await listEvents({ client: a, query: { sportLeagueId: nfl.id, eventYear: 2026 } })).data).events
      .find((row) => row.name === eventName), eventName);
    const event = await readEvent();
    created.sportEventIds.add(event.id);
    const readMatches = async () => expectDefined((await getEventBracket({ client: a, path: { eventId: event.id } })).data).matches;

    // Loaded ahead of its first kickoff: released, and every game, the Super Bowl too, still to play.
    const unplayed = await readMatches();
    expect(event.status).toBe('SCHEDULED');
    expect(unplayed).toHaveLength(13);
    expect(unplayed.every((match) => match.status === MatchStatus.SCHEDULED && match.homeScore === null)).toBe(true);

    // A run just before the Divisional round's first kickoff: the six Wild Card games are played.
    const kickoff = (match: (typeof unplayed)[number]) => Date.parse(expectDefined(match.scheduledDate));
    const roundStarts = (roundNumber: number) => Math.min(...unplayed.filter((match) => match.roundNumber === roundNumber).map(kickoff));
    const midway = new Date(roundStarts(2) - MINUTE_MS);
    const expectedMidway = [{ sportLeague: 'NFL', subject: LoadSubject.EVENT, action: LoadAction.UPDATE, name: eventName, detail: '6 results entered; moved to In Progress' }];

    expect(await catchUpTestEvents(file, { getClient, now: midway, mode: LoadMode.DRY_RUN })).toEqual(expectedMidway);
    expect((await readMatches()).every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);

    expect(await catchUpTestEvents(file, { getClient, now: midway, mode: LoadMode.APPLY })).toEqual(expectedMidway);
    expect((await readEvent()).status).toBe('IN_PROGRESS');
    const afterWildCard = await readMatches();
    expect(afterWildCard.filter((match) => match.status === MatchStatus.COMPLETED).map((match) => match.roundNumber)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(afterWildCard.filter((match) => match.roundNumber > 1).every((match) => match.status === MatchStatus.SCHEDULED)).toBe(true);

    // A run after the Super Bowl: the other seven games go in, reseeded rounds placed first, and the event completes.
    const superBowlKickoff = Math.max(...unplayed.map(kickoff));
    const after = new Date(superBowlKickoff + MINUTE_MS);
    expect(await catchUpTestEvents(file, { getClient, now: after, mode: LoadMode.APPLY })).toEqual([
      { sportLeague: 'NFL', subject: LoadSubject.EVENT, action: LoadAction.UPDATE, name: eventName, detail: '7 results entered; moved to Completed, settling its contests' },
    ]);
    expect((await readEvent()).status).toBe('COMPLETED');
    expect((await readMatches()).every((match) => match.status === MatchStatus.COMPLETED)).toBe(true);

    // A completed event is left alone.
    expect(await catchUpTestEvents(file, { getClient, now: after, mode: LoadMode.APPLY })).toEqual([]);
  });
});
