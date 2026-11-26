/**
 * #1248 — the sport catalog's list reads cost the same SQL statements for 2 rows as for 20: the
 * sport leagues, one sport league with its affiliations, the events and one event's field, rounds,
 * tiers and bracket, and the matchups proposed for a reseeded bracket round. The sports, a list
 * the platform fixes, cost the same pinned count.
 *
 * Each case seeds sport leagues of its own beside the reference data the migrations seed, which
 * the list also shows. `rules/testing-rules.md` §9B *Query Scaling Tests* says when a route
 * needs one.
 */
import { randomUUID } from 'crypto';
import { Sport, SportEventStatus } from '@poolmaster/shared/domain';
import {
  ParticipantListResponseSchema,
  SportEventBracketResponseSchema,
  SportEventListResponseSchema,
  SportEventResponseSchema,
  SportEventRoundListResponseSchema,
  SportEventRoundMatchupsResponseSchema,
  SportEventTierListResponseSchema,
  SportLeagueListResponseSchema,
  SportListResponseSchema,
  SportLeagueResponseSchema,
} from '@poolmaster/shared/dto';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { DAY, get, okBody, seedEventWithField, seedFootballWeek, seedTiers } from '../list-route-seeds';
import { expectConstantQueries, expectFixedQueries } from '../query-scaling';
import { recordStatements, statementCounts } from '../statement-log';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportRowKeys } from '../../support/sport-rows';
import { eventRoundSlots, fixtureSeasonId } from '../../support/event-edition';
import { linkTestSlot } from '../../support/test-slots';
import { sportPlay } from '../../support/sport-play';
import { oneEventSlotId } from '../../support/test-slots';
import { createMatchRow } from '../../support/match-rows';
import { HOME_SIDE } from '../../support/match-sides';

// No mocks.

// The public reads keep what they computed for a TTL; at 0 each read is its own, so the second
// run counts its read instead of being served the first run's.
const publicReadCacheTtl = process.env['PUBLIC_READ_CACHE_TTL_MS'];
beforeAll(async () => {
  process.env['PUBLIC_READ_CACHE_TTL_MS'] = '0';
  await setupIntegrationTests();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
  if (publicReadCacheTtl === undefined) delete process.env['PUBLIC_READ_CACHE_TTL_MS'];
  else process.env['PUBLIC_READ_CACHE_TTL_MS'] = publicReadCacheTtl;
});
beforeEach(() => cleanupTestData());

async function golf() {
  return getPrisma().sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF), tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
}

/** A golf sport league of its own, with `participants` golfers of its own, ranked, and one event. */
async function seedSportLeague(participants: number) {
  const prisma = getPrisma();
  const sport = await golf();
  const suffix = randomUUID().slice(0, 8);
  const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Scaling Catalog Tour ${suffix}` } });
  await prisma.sportEvent.create({
    data: {
      sportLeagueId: sportLeague.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, new Date().getUTCFullYear()), 
      name: `Scaling Catalog Open ${suffix}`, startDate: new Date(Date.now() + 30 * DAY),
    },
  });
  for (let index = 0; index < participants; index += 1) {
    await prisma.participant.create({
      data: { sportLeagueId: sportLeague.id, ranking: index + 1, name: `League Golfer ${suffix} ${String(index)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
    });
  }
  return sportLeague;
}

/** A root admin, and `sportLeagues` golf sport leagues of their own, each with a golfer and an event. */
async function seedSportLeagues(sportLeagues: number) {
  for (let index = 0; index < sportLeagues; index += 1) {
    await seedSportLeague(1);
  }
  return createTestUser({ isRootAdmin: true });
}

/**
 * A root admin, and a golf sport league of its own with `events` upcoming events, each in a series
 * of its own with a field of two and a tier, so the per-event field and tier counts scale too.
 */
async function seedSportLeagueEvents(events: number) {
  const prisma = getPrisma();
  const sportLeague = await seedSportLeague(0);
  for (let index = 0; index < events; index += 1) {
    const startDate = new Date(Date.now() + (31 + index) * DAY);
    const event = await prisma.sportEvent.create({
      data: {
        sportLeagueId: sportLeague.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, startDate.getUTCFullYear()), 
        name: `${sportLeague.name} Event ${String(index)}`, startDate,
      },
    });
    const field = [];
    for (let golfer = 0; golfer < 2; golfer += 1) {
      const participant = await prisma.participant.create({
        data: { sportLeagueId: sportLeague.id, name: `Event Golfer ${randomUUID().slice(0, 8)}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
      });
      field.push(await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, isActive: true } }));
    }
    await seedTiers(event.id, field, 1);
  }
  // Each event covers a slot, the league's own event included, so the list reads every event's slots (#2004).
  for (const event of await prisma.sportEvent.findMany({ where: { sportLeagueId: sportLeague.id }, select: { id: true, sportLeagueSeasonId: true, startDate: true } })) {
    await linkTestSlot(prisma, event);
  }
  return { sportLeague, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/** A root admin, and a golf event with `rounds` scheduled rounds a day apart. */
async function seedEventRounds(rounds: number) {
  const prisma = getPrisma();
  const { event } = await seedEventWithField(2);
  for (let roundNumber = 1; roundNumber <= rounds; roundNumber += 1) {
    await prisma.sportEventRound.create({
      data: { sportEventId: event.id, sportEventSlotId: await oneEventSlotId(prisma, event.id), roundNumber, scheduledDate: new Date(event.startDate.getTime() + (roundNumber - 1) * DAY) },
    });
  }
  return { event, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

/**
 * A released bracket of a sport league that reseeds, with `matchups` matches to place in round 2:
 * round 1's 2 x `matchups` games are played, each won by its home team and linking nowhere, so
 * round 2 is placed by seed; round 3 is the final. Every team has a seed.
 */
async function seedReseededRound(matchups: number) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.FOOTBALL },
    create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL), tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Scaling Reseed League ${suffix}` },
  });
  const startDate = new Date(Date.now() + 7 * DAY);
  const event = await prisma.sportEvent.create({
    data: {
      sportLeagueId: sportLeague.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, startDate.getUTCFullYear()), 
      name: `Scaling Reseed Playoffs ${suffix}`, startDate, status: SportEventStatus.SCHEDULED, rounds: 3,
    },
  });
  // Round 2's slot reseeds, so its games are placed by seed (#2006).
  const slotIds = await eventRoundSlots(prisma, event.id, [{ slotKind: 'QUARTERFINAL' }, { slotKind: 'SEMIFINAL', pairing: 'RESEEDED' }, { slotKind: 'FINAL' }]);
  const rounds = [];
  for (const [index, sportEventSlotId] of slotIds.entries()) {
    rounds.push(await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId, roundNumber: index + 1, scheduledDate: new Date(startDate.getTime() + index * 7 * DAY) } }));
  }
  const [wildCard, divisional, final] = rounds as [typeof rounds[number], typeof rounds[number], typeof rounds[number]];
  const firstRoundGames = matchups * 2;
  let matchNumber = 0;
  for (let game = 0; game < firstRoundGames; game += 1) {
    const team = async (seedNumber: number) => {
      const participant = await prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name: `Seed ${String(seedNumber)} ${suffix}`, participantType: 'TEAM' } });
      return prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, isActive: true, seedNumber } });
    };
    // The better seeds host and win: game N is seed N + 1 against seed 2 x games - N.
    const [home, away] = await Promise.all([team(game + 1), team(firstRoundGames * 2 - game)]);
    matchNumber += 1;
    await createMatchRow(prisma, {
      sportEventId: event.id, sportEventRoundId: wildCard.id, sportEventSlotId: wildCard.sportEventSlotId, matchNumber, isNeutralSite: false,
      teams: [away.id, home.id], result: { winnerSideNumber: HOME_SIDE, scores: [17, 20] },
    });
  }
  for (let game = 0; game < matchups; game += 1) {
    matchNumber += 1;
    await createMatchRow(prisma, { sportEventId: event.id, sportEventRoundId: divisional.id, sportEventSlotId: divisional.sportEventSlotId, matchNumber, teams: [null, null], isNeutralSite: false });
  }
  await createMatchRow(prisma, { sportEventId: event.id, sportEventRoundId: final.id, sportEventSlotId: final.sportEventSlotId, matchNumber: matchNumber + 1, teams: [null, null], isNeutralSite: true });
  return { event, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

describe('sport catalog reads cost the same statements for 2 rows as for 20', () => {
  it('GET the sport leagues: the same statements for 2 sport leagues of their own as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/',
      seed: seedSportLeagues,
      call: (rootAdmin) => get(`/api/v1/sport-leagues/?sport=${Sport.GOLF}`, rootAdmin),
      rowsShown: (response) => okBody(response, SportLeagueListResponseSchema).sportLeagues.length,
    });
  });

  it('GET a sport league: the same statements for 2 of its golfers as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}',
      seed: async (participants) => ({ sportLeague: await seedSportLeague(participants), rootAdmin: await createTestUser({ isRootAdmin: true }) }),
      call: ({ sportLeague, rootAdmin }) => get(`/api/v1/sport-leagues/${sportLeague.id}`, rootAdmin),
      rowsShown: (response) => okBody(response, SportLeagueResponseSchema).sportLeague.participantCount,
    });
  });

  it("GET a sport league's participants: the same statements for 2 of its golfers as for 20 (#1853)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}/participants',
      seed: async (participants) => ({ sportLeague: await seedSportLeague(participants), rootAdmin: await createTestUser({ isRootAdmin: true }) }),
      call: ({ sportLeague, rootAdmin }) => get(`/api/v1/sport-leagues/${sportLeague.id}/participants`, rootAdmin),
      rowsShown: (response) => okBody(response, ParticipantListResponseSchema).participants.length,
    });
  });

  it("GET a reseeded round's proposed matchups: the same statements for 2 matchups as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/{eventId}/bracket/rounds/{roundNumber}/reseed',
      seed: seedReseededRound,
      call: ({ event, rootAdmin }) => get(`/api/v1/events/${event.id}/bracket/rounds/2/reseed`, rootAdmin),
      rowsShown: (response) => okBody(response, SportEventRoundMatchupsResponseSchema).matches.length,
    });
  });

  it('GET the sports: one row per sport the platform runs, read in one query', async () => {
    const viewer = await createTestUser();
    await expectFixedQueries({
      route: 'GET /api/v1/sports/',
      fixedBy: 'the sports the platform runs',
      call: () => get('/api/v1/sports/', viewer),
      rowsShown: (response) => okBody(response, SportListResponseSchema).sports.length,
      statements: 1,
    });
  });

  it("GET a sport league's events: the same statements for 2 events as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/',
      seed: seedSportLeagueEvents,
      call: ({ sportLeague, rootAdmin }) => get(`/api/v1/events/?sportLeagueId=${sportLeague.id}`, rootAdmin),
      rowsShown: (response) => {
        const { events } = okBody(response, SportEventListResponseSchema);
        // Every event lists the slot it covers, so a read that skipped one would show here.
        for (const event of events) expect(event.slots).toHaveLength(1);
        return events.length;
      },
    });
  });

  it("GET a sport league's events: one event with its slot costs a fixed set of statements, its slots in two reads and its slot definitions in two more", async () => {
    // The league's own event only.
    const { sportLeague, rootAdmin } = await seedSportLeagueEvents(0);
    const { result, statements } = await recordStatements(() => get(`/api/v1/events/?sportLeagueId=${sportLeague.id}`, rootAdmin));
    expect(okBody(result, SportEventListResponseSchema).events.map((each) => each.slots.length)).toEqual([1]);
    // The listed slots are read once (#2004); the event read carries the slot definitions it
    // covers (#2010) through the same tables, a second read #2089 folds into the first.
    expect(statementCounts(statements).filter(([statement]) => statement.includes('sport_league_season_competition_slots') || statement.includes('sport_league_competition_slots'))).toEqual([
      ['SELECT sport_league_competition_slots', 2],
      ['SELECT sport_league_season_competition_slots', 2],
    ]);
  });

  it('GET an event: the same statements for a field of 2 as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/{eventId}',
      seed: async (golfers) => ({ ...(await seedEventWithField(golfers)), rootAdmin: await createTestUser({ isRootAdmin: true }) }),
      call: ({ event, rootAdmin }) => get(`/api/v1/events/${event.id}`, rootAdmin),
      rowsShown: (response) => okBody(response, SportEventResponseSchema).event.loadedParticipantCount,
    });
  });

  it("GET an event's rounds: the same statements for 2 rounds as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/{eventId}/rounds',
      seed: seedEventRounds,
      call: ({ event, rootAdmin }) => get(`/api/v1/events/${event.id}/rounds`, rootAdmin),
      rowsShown: (response) => okBody(response, SportEventRoundListResponseSchema).rounds.length,
    });
  });

  it("GET an event's tiers: the same statements for 2 tiers as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/{eventId}/tiers',
      seed: async (tiers) => {
        const { event, field } = await seedEventWithField(tiers);
        await seedTiers(event.id, field, tiers);
        return { event, rootAdmin: await createTestUser({ isRootAdmin: true }) };
      },
      call: ({ event, rootAdmin }) => get(`/api/v1/events/${event.id}/tiers`, rootAdmin),
      rowsShown: (response) => okBody(response, SportEventTierListResponseSchema).tiers.length,
    });
  });

  it("GET an event's bracket: the same statements for 2 games as for 20, each match holding its Game and the Game's provider id", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/{eventId}/bracket',
      seed: async (games) => ({
        ...(await seedFootballWeek({ games, startDate: new Date(Date.now() + 7 * DAY), status: SportEventStatus.SCHEDULED })),
        rootAdmin: await createTestUser({ isRootAdmin: true }),
      }),
      call: ({ event, rootAdmin }) => get(`/api/v1/events/${event.id}/bracket`, rootAdmin),
      rowsShown: (response) => okBody(response, SportEventBracketResponseSchema).matches.length,
    });
  });
});
