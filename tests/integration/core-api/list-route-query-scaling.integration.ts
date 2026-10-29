/**
 * #1242 — the list routes the 2026-10-28 audit fixed cost the same SQL statements for 2 rows as
 * for 20, which keeps those fixes fixed (#1205, #1207, #1210, #1211, #1213, #1214, #1216).
 *
 * Each case seeds one fresh league (or event) holding `rows` child rows and reads it through the
 * real route. `rules/testing-rules.md` §9B *Query Scaling Tests* says when a route needs one.
 */
import { randomUUID } from 'crypto';
import { ContestFormat, ContestStatus, CupWeight, SelectionType, Sport } from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import {
  ChampionshipYearListResponseSchema,
  ContestListResponseSchema,
  ContestResultListResponseSchema,
  CupListResponseSchema,
  HistorySummaryResponseSchema,
  LeagueListResponseSchema,
  LeagueMembersResponseSchema,
  SportEventParticipantListResponseSchema,
  SquadHistoryResponseSchema,
  SquadListResponseSchema,
  SportEventYearListResponseSchema,
} from '@poolmaster/shared/dto';
import { expectConstantQueries } from '../query-scaling';
import { get, okBody, seedEventWithField, seedLeagueWithTeams } from '../list-route-seeds';
import { PrismaContestRepository } from '../../../packages/core-api/src/adapters';
import { createContestRow } from '../../support/contest-rows';
import { freshEventEdition } from '../../support/event-edition';

// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** `contests` open roster contests in one league, each on an upcoming event of its own, so a read per event scales too. */
async function seedLeagueWithContests(contests: number) {
  const seeded = await seedLeagueWithTeams(1);
  const contestRows = new PrismaContestRepository(getAppPrisma());
  for (let index = 0; index < contests; index += 1) {
    const { event } = await seedEventWithField(2);
    await createContestRow(contestRows, {
      leagueId: seeded.league.id,
      seasonYear: event.startDate.getUTCFullYear(),
      sportEventIds: [event.id],
      name: `Contest ${seeded.suffix} ${index}`,
      status: ContestStatus.OPEN,
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.TIERED,
    });
  }
  return seeded;
}

/** The year the trophy room's seeds end in: last year, so every seeded year is over. */
const LAST_SEEDED_YEAR = new Date().getUTCFullYear() - 1;

/**
 * A league's trophy room: two teams, and `years` years each with `contestsPerYear` final
 * contests, the first team 1st and the second 2nd in each, and each year's cups. The contests
 * share the fixture tour and the year's one cup, or with `cupPerContest` each has a sports league
 * and a cup of its own. Finishes are written as settlement leaves them.
 */
async function seedTrophyRoom({ years, contestsPerYear, cupPerContest = false }: { years: number; contestsPerYear: number; cupPerContest?: boolean }) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(2);
  const [first, second] = seeded.squads;
  for (let offset = 0; offset < years; offset += 1) {
    const year = LAST_SEEDED_YEAR - offset;
    const endsAt = new Date(`${String(year)}-06-15T12:00:00.000Z`);
    for (let index = 0; index < contestsPerYear; index += 1) {
      const edition = await freshEventEdition(prisma, { eventYear: year });
      if (cupPerContest) {
        const { sportId } = await prisma.sportLeague.findFirstOrThrow({ where: { eventSeries: { some: { id: edition.eventSeriesId } } } });
        const tour = await prisma.sportLeague.create({ data: { sportId, name: `Scaling Tour ${seeded.suffix} ${String(year)} ${String(index)}` } });
        await prisma.eventSeries.update({ where: { id: edition.eventSeriesId }, data: { sportLeagueId: tour.id } });
      }
      const event = await prisma.sportEvent.create({
        data: {
          ...edition,
          externalId: `scaling-${randomUUID()}`,
          providerId: 'integration-test',
          sport: Sport.GOLF,
          name: `Scaling Final ${seeded.suffix} ${String(year)} ${String(index)}`,
          startDate: new Date(`${String(year)}-06-11T12:00:00.000Z`),
        },
      });
      const contest = await prisma.contest.create({
        data: {
          leagueId: seeded.league.id,
          seasonYear: year,
          name: `Final ${String(year)} ${String(index)}`,
          status: ContestStatus.COMPLETED,
          selectionType: SelectionType.TIERED,
          endsAt,
          sportEvents: { create: { sportEventId: event.id, sequence: 1 } },
        },
      });
      for (const [position, squad] of [first, second].entries()) {
        const entry = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squad.id, name: squad.name } });
        await prisma.contestEntryStanding.create({
          data: { contestId: contest.id, contestEntryId: entry.id, position: position + 1, countingPickLimit: 4, scoredPickCount: 4, settledAt: endsAt },
        });
        await prisma.leagueYearFinish.create({
          data: {
            leagueId: seeded.league.id, year, squadId: squad.id, contestId: contest.id, place: position + 1, tiedCount: 1,
            rankedEntryCount: 2, weight: CupWeight.NORMAL, points: position === 0 ? 1000 : 500, settledAt: endsAt,
          },
        });
      }
      if (cupPerContest || index === 0) {
        const { sportLeagueId } = await prisma.eventSeries.findUniqueOrThrow({ where: { id: edition.eventSeriesId } });
        await prisma.cup.create({ data: { leagueId: seeded.league.id, seasonYear: year, sportLeagueId } });
      }
    }
  }
  return seeded;
}

/** A sport league of its own with one released golf event in each of `years` past years. */
async function seedSportLeagueWithYears(years: number) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.create({ data: { sportId: sport.id, name: `Scaling Years Tour ${suffix}` } });
  const series = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `Scaling Years Open ${suffix}` } });
  for (let offset = 0; offset < years; offset += 1) {
    const year = LAST_SEEDED_YEAR - offset;
    await prisma.sportEvent.create({
      data: {
        eventSeriesId: series.id,
        eventYear: year,
        externalId: `scaling-${randomUUID()}`,
        providerId: 'integration-test',
        sport: Sport.GOLF,
        name: `Scaling Years Open ${suffix} ${String(year)}`,
        startDate: new Date(`${String(year)}-06-11T12:00:00.000Z`),
        status: 'COMPLETED',
      },
    });
  }
  return sportLeague;
}

describe('list routes cost the same statements for 2 rows as for 20', () => {
  it("GET a viewer's leagues: the same statements for 2 leagues as for 20 (#1205, #1216)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/',
      seed: async (leagues) => {
        const viewer = await createTestUser();
        for (let index = 0; index < leagues; index += 1) {
          const { league } = await seedLeagueWithTeams(1);
          await getPrisma().leagueMembership.create({ data: { leagueId: league.id, userId: viewer.user.id, role: 'MEMBER', status: 'ACTIVE' } });
        }
        return viewer;
      },
      call: (viewer) => get('/api/v1/leagues/', viewer),
      rowsShown: (response) => okBody(response, LeagueListResponseSchema).leagues.length,
    });
  });

  it("GET a league's teams with their owners: the same statements for 2 teams as for 20 (#1207)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/squads/',
      seed: seedLeagueWithTeams,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/squads/`, commissioner),
      rowsShown: (response) => okBody(response, SquadListResponseSchema).squads.length,
    });
  });

  it("GET a league's members: the same statements for 2 members as for 20 (#1216)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/members',
      seed: seedLeagueWithTeams,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/members`, commissioner),
      rowsShown: (response) => okBody(response, LeagueMembersResponseSchema).members.length,
    });
  });

  it("GET a league's current contests: the same statements for 2 contests as for 20 (#1210, #1211)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contests/',
      seed: seedLeagueWithContests,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/contests/`, commissioner),
      rowsShown: (response) => okBody(response, ContestListResponseSchema).contests.length,
    });
  });

  it("GET an event's field: the same statements for 2 players as for 20 (#1214)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/{eventId}/participants',
      seed: async (golfers) => ({ ...(await seedEventWithField(golfers)), viewer: await createTestUser() }),
      call: ({ event, viewer }) => get(`/api/v1/events/${event.id}/participants`, viewer),
      rowsShown: (response) => okBody(response, SportEventParticipantListResponseSchema).participants.length,
    });
  });

  it("GET a sport league's event years: the same statements for 2 years as for 20 (#1198)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/events/years',
      seed: async (years) => ({ sportLeague: await seedSportLeagueWithYears(years), viewer: await createTestUser() }),
      call: ({ sportLeague, viewer }) => get(`/api/v1/events/years?sportLeagueId=${sportLeague.id}`, viewer),
      rowsShown: (response) => okBody(response, SportEventYearListResponseSchema).years.length,
    });
  });

  it("GET a league's All years summary: the same statements for 2 years as for 20 (#1213)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/history/summary',
      seed: (years) => seedTrophyRoom({ years, contestsPerYear: 1 }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/history/summary`, commissioner),
      rowsShown: (response) => okBody(response, HistorySummaryResponseSchema).summary.years.length,
    });
  });

  it("GET a team's history: the same statements for 2 years as for 20 (#1213)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/history/squads/{squadId}/years',
      seed: (years) => seedTrophyRoom({ years, contestsPerYear: 1 }),
      call: ({ league, squads, commissioner }) => get(`/api/v1/leagues/${league.id}/history/squads/${squads[0].id}/years`, commissioner),
      rowsShown: (response) => okBody(response, SquadHistoryResponseSchema).squadHistory.years.length,
    });
  });

  it("GET a league's championship years: the same statements for 2 years as for 20 (#1213)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/championship/',
      seed: (years) => seedTrophyRoom({ years, contestsPerYear: 1 }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/championship/`, commissioner),
      rowsShown: (response) => okBody(response, ChampionshipYearListResponseSchema).years.length,
    });
  });

  it("GET a year's final contests: the same statements for 2 contests as for 20 (#1213)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/history/contests',
      seed: (contestsPerYear) => seedTrophyRoom({ years: 1, contestsPerYear }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/history/contests?year=${String(LAST_SEEDED_YEAR)}`, commissioner),
      rowsShown: (response) => okBody(response, ContestResultListResponseSchema).contests.length,
    });
  });

  it("GET a season's cups: the same statements for 2 cups as for 20 (#1213)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/cups/',
      seed: (cups) => seedTrophyRoom({ years: 1, contestsPerYear: cups, cupPerContest: true }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/cups/?seasonYear=${String(LAST_SEEDED_YEAR)}`, commissioner),
      rowsShown: (response) => okBody(response, CupListResponseSchema).cups.length,
    });
  });

  it("GET a season's cups: the same statements for 2 contests in the one cup as for 20 (#1213)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/cups/',
      seed: (contestsPerYear) => seedTrophyRoom({ years: 1, contestsPerYear }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/cups/?seasonYear=${String(LAST_SEEDED_YEAR)}`, commissioner),
      rowsShown: (response) => okBody(response, CupListResponseSchema).cups.reduce((total, cup) => total + cup.contests.length, 0),
    });
  });
});
