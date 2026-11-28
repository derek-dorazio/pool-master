/**
 * The championship calendar (#2021) costs the same SQL statements for a league with 2 contest
 * years as for 20: its contests, closed years, slots still to play and current Seasons are each
 * read once. `rules/testing-rules.md` §9B *Query Scaling Tests* says when a route needs one.
 */
import type { ChampionshipCalendarResponse } from '@poolmaster/shared/dto';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { get, seedLeagueWithTeams } from '../list-route-seeds';
import { expectConstantQueries } from '../query-scaling';
import { anySeason } from '../../support/contest-rows';

// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/**
 * A league with a contest in each of `years` championship years, every other one live and the
 * rest open, and a finished contest beside each, which the calendar reads only grouped by year.
 */
async function seedContestYears(years: number) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(0);
  for (let index = 0; index < years; index += 1) {
    // poolmaster-allow-query-in-loop: a fixture's few Seasons and contests
    const season = await anySeason(prisma, 2040 + index);
    // poolmaster-allow-query-in-loop: a fixture's few Seasons and contests
    await prisma.contest.create({
      data: { leagueId: seeded.league.id, ...season, name: `Year ${String(index)} pool`, status: index % 2 === 0 ? 'ACTIVE' : 'OPEN', selectionType: 'TIERED' },
    });
    // poolmaster-allow-query-in-loop: a fixture's few Seasons and contests
    await prisma.contest.create({ data: { leagueId: seeded.league.id, ...season, name: `Year ${String(index)} final`, status: 'COMPLETED', selectionType: 'TIERED' } });
  }
  return seeded;
}

describe('the championship calendar costs the same statements for 2 contest years as for 20', () => {
  it('GET the championship calendar: the same statements for 2 contest years as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/championship/calendar',
      seed: seedContestYears,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/championship/calendar`, commissioner),
      rowsShown: (response) => response.json<ChampionshipCalendarResponse>().years.flatMap((year) => year.unfinishedContests).length,
    });
  });
});
