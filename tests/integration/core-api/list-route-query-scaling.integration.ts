/**
 * #1242 — the list routes the 2026-10-28 audit fixed cost the same SQL statements for 2 rows as
 * for 20, which keeps those fixes fixed (#1205, #1207, #1210, #1211, #1213, #1214, #1216).
 *
 * Each case seeds one fresh league (or event) holding `rows` child rows and reads it through the
 * real route. `rules/testing-rules.md` §9B *Query Scaling Tests* says when a route needs one.
 */
import { randomUUID } from 'crypto';
import { ContestFormat, ContestStatus, CupWeight, RecordType, SelectionType, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import {
  ChampionshipResponseSchema,
  ChampionshipYearListResponseSchema,
  ContestListResponseSchema,
  ContestResultListResponseSchema,
  CupListResponseSchema,
  CupResponseSchema,
  CupSeasonListResponseSchema,
  CupSquadPointsResponseSchema,
  HistorySummaryResponseSchema,
  LeagueListResponseSchema,
  LeagueMembersResponseSchema,
  PerpetualTrophyListResponseSchema,
  RecordListResponseSchema,
  SportEventParticipantListResponseSchema,
  SquadHistoryResponseSchema,
  SquadListResponseSchema,
  SquadYearResponseSchema,
  SportLeagueSeasonListResponseSchema,
} from '@poolmaster/shared/dto';
import { expectConstantQueries } from '../query-scaling';
import { get, okBody, seedEventWithField, seedFootballWeek, seedLeagueWithTeams } from '../list-route-seeds';
import { PrismaContestRepository } from '../../../packages/core-api/src/adapters';
import { contestOnEvents, createContestRow } from '../../support/contest-rows';
import { fixtureSeasonId, freshEventEdition, putEventInSlot, keyedSlotDefinitionId } from '../../support/event-edition';
import { SYNCED_SLOT_KEY_PREFIX } from '../../support/test-slots';
import { expectDefined } from '../../support/expect-defined';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportRowKeys } from '../../support/sport-rows';
import { sportPlay } from '../../support/sport-play';

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
    await createContestRow(getPrisma(), contestRows, {
      leagueId: seeded.league.id,
      sportEventIds: [event.id],
      name: `Contest ${seeded.suffix} ${index}`,
      status: ContestStatus.OPEN,
      contestFormat: ContestFormat.ROSTER,
      selectionType: SelectionType.TIERED,
    });
  }
  return seeded;
}

const HOUR = 60 * 60 * 1000;

/**
 * A league with `contests` live one-week pick'em contests, each on its own NFL week of three games
 * with one played, so the list reads every week's games for its progress (#1782).
 */
async function seedLeagueWithLivePickEms(contests: number) {
  const seeded = await seedLeagueWithTeams(1);
  const contestRows = new PrismaContestRepository(getAppPrisma());
  for (let index = 0; index < contests; index += 1) {
    const { event } = await seedFootballWeek({ games: 3, startDate: new Date(Date.now() - HOUR), status: SportEventStatus.IN_PROGRESS, played: 1 });
    await createContestRow(getPrisma(), contestRows, {
      leagueId: seeded.league.id,
      sportEventIds: [event.id],
      name: `Pick'em ${seeded.suffix} ${index}`,
      status: ContestStatus.ACTIVE,
      contestFormat: ContestFormat.PREDICTION,
      selectionType: SelectionType.PICK_EM,
    });
  }
  return seeded;
}

/** The year the trophy room's seeds end in: last year, so every seeded year is over. */
const LAST_SEEDED_YEAR = new Date().getUTCFullYear() - 1;

/**
 * A league's trophy room: `teams` teams (two by default), and `years` years each with
 * `contestsPerYear` final contests, the teams placing in order in each, and each year's cups. The
 * contests share the fixture tour and the year's one cup, or with `cupPerContest` each has a
 * sports league and a cup of its own. With `recurring` the year's Nth contest is on the same
 * event series every year, so each earns a perpetual trophy. Finishes are written as settlement
 * leaves them.
 */
async function seedTrophyRoom({ years, contestsPerYear, cupPerContest = false, recurring = false, teams = 2 }: {
  years: number;
  contestsPerYear: number;
  cupPerContest?: boolean;
  recurring?: boolean;
  teams?: number;
}) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(teams);
  // A recurring contest is run each year on the same slot definition (#2010), which keeps its trophy.
  const slotByIndex = new Map<number, { sportLeagueId: string; definitionId: string }>();
  for (let offset = 0; offset < years; offset += 1) {
    const year = LAST_SEEDED_YEAR - offset;
    const endsAt = new Date(`${String(year)}-06-15T12:00:00.000Z`);
    for (let index = 0; index < contestsPerYear; index += 1) {
      const recurringSlot = recurring ? slotByIndex.get(index) : undefined;
      // A cup per contest puts each new contest on a sport league of its own.
      const ownTour = cupPerContest && recurringSlot === undefined
        ? await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), sportId: (await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } })).id, name: `Scaling Tour ${seeded.suffix} ${String(year)} ${String(index)}` } })
        : undefined;
      const edition = await freshEventEdition(prisma, { championshipYear: year, sportLeagueId: recurringSlot?.sportLeagueId ?? ownTour?.id });
      const event = await prisma.sportEvent.create({
        data: {
          ...edition,
          name: `Scaling Final ${seeded.suffix} ${String(year)} ${String(index)}`,
          startDate: new Date(`${String(year)}-06-11T12:00:00.000Z`),
        },
      });
      if (recurring) {
        const slot = recurringSlot ?? { sportLeagueId: edition.sportLeagueId, definitionId: await keyedSlotDefinitionId(prisma, edition.sportLeagueId, `${SYNCED_SLOT_KEY_PREFIX}SCALING_${seeded.suffix}_${String(index)}`.toUpperCase()) };
        slotByIndex.set(index, slot);
        await putEventInSlot(prisma, event.id, slot.definitionId);
      }
      const contest = await prisma.contest.create({
        data: {
          leagueId: seeded.league.id,
          ...(await contestOnEvents(prisma, [event.id])),
          name: `Final ${String(year)} ${String(index)}`,
          status: ContestStatus.COMPLETED,
          selectionType: SelectionType.TIERED,
          endsAt,
        },
      });
      for (const [position, squad] of seeded.squads.entries()) {
        const entry = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squad.id, name: squad.name } });
        await prisma.contestEntryStanding.create({
          data: { contestId: contest.id, contestEntryId: entry.id, position: position + 1, countingPickLimit: 4, scoredPickCount: 4, settledAt: endsAt },
        });
        await prisma.leagueYearFinish.create({
          data: {
            leagueId: seeded.league.id, year, squadId: squad.id, contestId: contest.id, place: position + 1, tiedCount: 1,
            rankedEntryCount: seeded.squads.length, weight: CupWeight.NORMAL, points: Math.max(1000 - position * 50, 0), settledAt: endsAt,
          },
        });
      }
      if (cupPerContest || index === 0) {
        const { sportLeagueId } = edition;
        await prisma.cup.create({ data: { leagueId: seeded.league.id, sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeagueId, year), sportLeagueId } });
      }
    }
  }
  return seeded;
}

/** A sport league of its own with `years` past Seasons, each with one released golf event. */
async function seedSportLeagueWithSeasons(years: number) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, ...sportRowKeys(Sport.GOLF) },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Scaling Seasons Tour ${suffix}` } });
  for (let offset = 0; offset < years; offset += 1) {
    const year = LAST_SEEDED_YEAR - offset;
    await prisma.sportEvent.create({
      data: {
        sportLeagueId: sportLeague.id,
        sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, year),
        name: `Scaling Seasons Open ${suffix} ${String(year)}`,
        startDate: new Date(`${String(year)}-06-11T12:00:00.000Z`),
        status: 'COMPLETED',
      },
    });
  }
  return sportLeague;
}

/** The league's one cup of the last seeded year: the trophy room's cup when its contests share one. */
async function onlyCup(leagueId: string) {
  return getPrisma().cup.findFirstOrThrow({ where: { leagueId, sportLeagueSeason: { championshipYear: LAST_SEEDED_YEAR } }, include: { sportLeagueSeason: { select: { championshipYear: true } } } });
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

  it("GET a league's live one-week pick'ems: the same statements for 2 as for 20, each with its games played (#1782)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/contests/',
      seed: seedLeagueWithLivePickEms,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/contests/`, commissioner),
      rowsShown: (response) => {
        const { contests } = okBody(response, ContestListResponseSchema);
        expect(contests.map((contest) => contest.progress)).toEqual(contests.map(() => ({ played: 1, total: 3, unit: 'GAMES' })));
        return contests.length;
      },
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

  it("GET a sport league's Seasons: the same statements for 2 Seasons as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/sport-leagues/{sportLeagueId}/seasons',
      seed: async (years) => ({ sportLeague: await seedSportLeagueWithSeasons(years), viewer: await createTestUser() }),
      call: ({ sportLeague, viewer }) => get(`/api/v1/sport-leagues/${sportLeague.id}/seasons`, viewer),
      rowsShown: (response) => okBody(response, SportLeagueSeasonListResponseSchema).seasons.length,
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

  it("GET a year's final contests with one team's finish on each: the same statements for 2 contests as for 20 (#1570)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/history/contests',
      seed: (contestsPerYear) => seedTrophyRoom({ years: 1, contestsPerYear }),
      call: ({ league, commissioner, squads }) => get(
        `/api/v1/leagues/${league.id}/history/contests?year=${String(LAST_SEEDED_YEAR)}&finishOf=${expectDefined(squads[0]).id}`,
        commissioner,
      ),
      rowsShown: (response) => okBody(response, ContestResultListResponseSchema).contests.filter((contest) => contest.squadFinish !== null).length,
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

  it('GET the seasons with cups: the same statements for 2 seasons as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/cups/seasons',
      seed: (years) => seedTrophyRoom({ years, contestsPerYear: 1 }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/cups/seasons`, commissioner),
      rowsShown: (response) => okBody(response, CupSeasonListResponseSchema).seasonYears.length,
    });
  });

  it("GET a team's points in a cup: the same statements for 2 counted contests as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/cups/squads/{squadId}',
      seed: async (contestsPerYear) => {
        const seeded = await seedTrophyRoom({ years: 1, contestsPerYear });
        return { ...seeded, cup: await onlyCup(seeded.league.id) };
      },
      call: ({ league, squads, cup, commissioner }) => get(
        `/api/v1/leagues/${league.id}/cups/squads/${expectDefined(squads[0]).id}?seasonYear=${String(cup.sportLeagueSeason.championshipYear)}&sportLeagueId=${cup.sportLeagueId}`,
        commissioner,
      ),
      rowsShown: (response) => okBody(response, CupSquadPointsResponseSchema).squadPoints.contests.length,
    });
  });

  it('GET a cup: the same statements for 2 contests as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/cups/{cupId}',
      seed: async (contestsPerYear) => {
        const seeded = await seedTrophyRoom({ years: 1, contestsPerYear });
        return { ...seeded, cup: await onlyCup(seeded.league.id) };
      },
      call: ({ league, cup, commissioner }) => get(`/api/v1/leagues/${league.id}/cups/${cup.id}`, commissioner),
      rowsShown: (response) => okBody(response, CupResponseSchema).cup.contests.length,
    });
  });

  it('GET a cup: the same statements for 2 teams as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/cups/{cupId}',
      seed: async (teams) => {
        const seeded = await seedTrophyRoom({ years: 1, contestsPerYear: 2, teams });
        return { ...seeded, cup: await onlyCup(seeded.league.id) };
      },
      call: ({ league, cup, commissioner }) => get(`/api/v1/leagues/${league.id}/cups/${cup.id}`, commissioner),
      rowsShown: (response) => okBody(response, CupResponseSchema).cup.standings.length,
    });
  });

  it("GET a championship year: the same statements for 2 counted contests as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/championship/{year}',
      seed: (contestsPerYear) => seedTrophyRoom({ years: 1, contestsPerYear }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/championship/${String(LAST_SEEDED_YEAR)}`, commissioner),
      rowsShown: (response) => expectDefined(okBody(response, ChampionshipResponseSchema).championship.standings[0]).played,
    });
  });

  it('GET a championship year: the same statements for 2 teams as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/championship/{year}',
      seed: (teams) => seedTrophyRoom({ years: 1, contestsPerYear: 2, teams }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/championship/${String(LAST_SEEDED_YEAR)}`, commissioner),
      rowsShown: (response) => okBody(response, ChampionshipResponseSchema).championship.standings.length,
    });
  });

  it("GET a league's perpetual trophies: the same statements for 2 trophies as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/history/trophies',
      seed: (contestsPerYear) => seedTrophyRoom({ years: 2, contestsPerYear, cupPerContest: true, recurring: true }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/history/trophies`, commissioner),
      rowsShown: (response) => okBody(response, PerpetualTrophyListResponseSchema).trophies.length,
    });
  });

  it("GET a league's perpetual trophies: the same statements for 2 years' plates as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/history/trophies',
      seed: (years) => seedTrophyRoom({ years, contestsPerYear: 1, recurring: true }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/history/trophies`, commissioner),
      rowsShown: (response) => okBody(response, PerpetualTrophyListResponseSchema).trophies.reduce((total, trophy) => total + trophy.plates.length, 0),
    });
  });

  it("GET a league's record book: the same statements for 2 years' wins as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/history/records',
      seed: (years) => seedTrophyRoom({ years, contestsPerYear: 1 }),
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/history/records`, commissioner),
      rowsShown: (response) => expectDefined(
        okBody(response, RecordListResponseSchema).records.find((record) => record.type === RecordType.MOST_WINS_ALL_TIME),
      ).best.value,
    });
  });

  it("GET a team's year: the same statements for 2 cups as for 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/history/squads/{squadId}',
      seed: (cups) => seedTrophyRoom({ years: 1, contestsPerYear: cups, cupPerContest: true }),
      call: ({ league, squads, commissioner }) => get(
        `/api/v1/leagues/${league.id}/history/squads/${expectDefined(squads[0]).id}?year=${String(LAST_SEEDED_YEAR)}`,
        commissioner,
      ),
      rowsShown: (response) => okBody(response, SquadYearResponseSchema).squadYear.cups.length,
    });
  });
});
