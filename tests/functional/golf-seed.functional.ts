import { listEventParticipants, listEvents, listParticipants, listSportLeagues, listSports } from '@poolmaster/shared/generated/hey-api';
import { seedGolf } from '../../packages/core-api/scripts/seed-golf/seed-golf';
import type { GolfSeedFile, GolfSeedGolfer } from '../../packages/core-api/scripts/seed-golf/seed-golf-data';
import { buildRegisteredUser, promoteToRootAdmin } from './builders';
import { disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';

// The manual-testing golf seed, run through the real admin API: what a commissioner gets to
// build contests on, and that running it again changes nothing.

const RUN = `seed-${Date.now()}`;
const TOUR = `Seed Tour ${RUN}`;
const NOW = new Date('2026-10-08T19:00:00Z');

function golfer(index: number, rounds: number[], extra: Partial<GolfSeedGolfer> = {}): GolfSeedGolfer {
  return { player: `${RUN}-p${index}`, ranking: index, oddsToWin: 5 + index, rounds, ...extra };
}

const seed: GolfSeedFile = {
  season: 2026,
  notes: 'functional test seed',
  tours: [{
    name: TOUR,
    players: Array.from({ length: 12 }, (_, index) => ({
      key: `${RUN}-p${index + 1}`,
      name: `${RUN} Golfer ${index + 1}`,
      countryCode: 'US',
      ranking: index + 1,
    })),
    events: [
      {
        key: 'first',
        name: `${RUN} Opener`,
        startDate: '2026-01-15',
        endDate: '2026-01-18',
        venue: 'Seed Links',
        location: 'Testville, US',
        rounds: 4,
        roundsPar: 72,
        winner: 'public',
        field: [
          golfer(1, [66, 67, 68, 69]),
          ...Array.from({ length: 9 }, (_, index) => golfer(index + 2, [70, 71, 72, 70 + index])),
          golfer(11, [78, 79], { finish: 'MC' }),
          golfer(12, [71, 40], { finish: 'WD', withdrawnThru: 9 }),
        ],
      },
      {
        key: 'second',
        name: `${RUN} Classic`,
        startDate: '2026-01-22',
        endDate: '2026-01-25',
        venue: null,
        location: null,
        rounds: 4,
        roundsPar: 70,
        winner: 'generated',
        field: Array.from({ length: 8 }, (_, index) => golfer(index + 1, [69, 70, 71, 68 + index])),
      },
    ],
  }],
};

async function cleanup(): Promise<void> {
  const db = getFunctionalPrisma();
  const eventIds = (await db.sportEvent.findMany({ where: { name: { contains: RUN } }, select: { id: true } })).map((event) => event.id);
  const fieldIds = (await db.sportEventParticipant.findMany({ where: { sportEventId: { in: eventIds } }, select: { id: true } })).map((row) => row.id);
  await db.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: { sportEventParticipantId: { in: fieldIds } } } });
  await db.sportEventParticipantRound.deleteMany({ where: { sportEventParticipantId: { in: fieldIds } } });
  await db.sportEventParticipantGolfStanding.deleteMany({ where: { standing: { sportEventParticipantId: { in: fieldIds } } } });
  await db.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipantId: { in: fieldIds } } });
  await db.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipantId: { in: fieldIds } } });
  await db.sportEventParticipant.deleteMany({ where: { id: { in: fieldIds } } });
  await db.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
  await db.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
  const participantIds = (await db.participant.findMany({ where: { externalId: { startsWith: RUN } }, select: { id: true } })).map((p) => p.id);
  await db.participantLeagueAffiliation.deleteMany({ where: { participantId: { in: participantIds } } });
  await db.participant.deleteMany({ where: { id: { in: participantIds } } });
  const leagueIds = (await db.sportLeague.findMany({ where: { name: TOUR }, select: { id: true } })).map((league) => league.id);
  await db.eventSeries.deleteMany({ where: { sportLeagueId: { in: leagueIds } } });
  await db.sportLeague.deleteMany({ where: { id: { in: leagueIds } } });
}

afterAll(async () => {
  await cleanup();
  await disconnectFunctionalPrisma();
});

describe('Golf manual-testing seed through the admin API', () => {
  it('releases every seeded tournament a week ahead, with its field, tiers and stored final scores, and a second run skips them all and keeps hand-edited tour rankings', async () => {
    const admin = await buildRegisteredUser({ displayName: 'Seed Admin' });
    await promoteToRootAdmin(admin);
    const client = admin.client;
    const getClient = () => Promise.resolve(client);

    const first = await seedGolf(seed, { getClient, now: NOW });
    expect(first).toEqual([{ tour: TOUR, created: [`${RUN} Opener`, `${RUN} Classic`], skipped: [] }]);

    const golfSportId = (await listSports({ client })).data!.sports.find((sport) => sport.name === 'GOLF')!.id;
    const tour = (await listSportLeagues({ client, query: { sport: 'GOLF' } })).data!.sportLeagues.find((league) => league.name === TOUR)!;
    expect(tour.matchKeyword).toBe(TOUR);
    const events = (await listEvents({ client, query: { sportLeagueId: tour.id, eventYear: 2026 } })).data!.events;
    const opener = events.find((event) => event.name === `${RUN} Opener`)!;

    // Released for contests, a whole number of weeks on from 2026-01-15 and at least a week after NOW.
    expect(events.map((event) => event.status)).toEqual(['SCHEDULED', 'SCHEDULED']);
    expect(opener.startDate).toBe('2026-10-22T12:00:00.000Z');
    expect(opener.autoLifecycleEnabled).toBe(false);

    const field = (await listEventParticipants({ client, path: { eventId: opener.id } })).data!.participants;
    const byName = new Map(field.map((row) => [row.participant.name, row]));
    expect(field).toHaveLength(12);
    expect(field.every((row) => row.valuation?.sportEventTierId && row.valuation.price !== null)).toBe(true);
    expect(byName.get(`${RUN} Golfer 1`)).toMatchObject({ ranking: 1, oddsToWin: 6, seedNumber: 1 });
    expect(byName.get(`${RUN} Golfer 1`)!.standing).toMatchObject({ position: 1, status: 'COMPLETE' });
    expect(byName.get(`${RUN} Golfer 11`)!.standing).toMatchObject({ position: null, status: 'ELIMINATED' });
    expect(byName.get(`${RUN} Golfer 12`)!.standing).toMatchObject({ position: null, status: 'WITHDRAWN' });
    expect(byName.get(`${RUN} Golfer 12`)!.rounds.find((round) => round.roundNumber === 2)?.status).toBe('DNF');

    // A ranking an admin changed by hand survives the next run.
    const db = getFunctionalPrisma();
    const golferOne = await db.participant.findFirstOrThrow({ where: { externalId: `${RUN}-p1` } });
    await db.participantLeagueAffiliation.update({
      where: { participantId_sportLeagueId: { participantId: golferOne.id, sportLeagueId: tour.id } },
      data: { ranking: 99 },
    });

    const second = await seedGolf(seed, { getClient, now: NOW });
    expect(second).toEqual([{
      tour: TOUR,
      created: [],
      skipped: [{ name: `${RUN} Opener`, status: 'SCHEDULED' }, { name: `${RUN} Classic`, status: 'SCHEDULED' }],
    }]);
    const golfers = (await listParticipants({ client, query: { sportId: golfSportId, q: RUN } })).data!.participants;
    expect(golfers).toHaveLength(12);
    const affiliation = await db.participantLeagueAffiliation.findUniqueOrThrow({
      where: { participantId_sportLeagueId: { participantId: golferOne.id, sportLeagueId: tour.id } },
    });
    expect(affiliation.ranking).toBe(99);
  });
});
