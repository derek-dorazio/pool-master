import { getChampionshipCalendar } from '@poolmaster/shared/generated/hey-api';
import { SelectionType } from '@poolmaster/shared/domain';
import { buildLeagueWithCommissioner, buildRegisteredUser, seedContestFixture } from './builders';
import { cleanupFunctionalData, disconnectFunctionalPrisma, getFunctionalPrisma } from './setup';
import { expectDefined } from '../support/expect-defined';
import { anySeason } from '../support/contest-rows';

// The championship calendar (#2021) through the real route: the year the league is in now comes
// from its contests and closed years, and a new league's from the sport leagues' current Seasons,
// never from the clock. Which slot holds a year open is unit and integration tested.

afterAll(async () => {
  await cleanupFunctionalData();
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: the championship calendar (#2021)', () => {
  it('opens a new league on the earliest current Season year, then on its open contest year, prefers a year with a live contest, moves on once a year closes, and is for members only', async () => {
    const prisma = getFunctionalPrisma();
    const { commissioner, league } = await buildLeagueWithCommissioner({ displayName: 'Calendar Keeper', leagueName: `Calendar League ${Date.now()}` });
    const outsider = await buildRegisteredUser({ displayName: 'Calendar Outsider' });
    const calendar = async () => expectDefined((await getChampionshipCalendar({ client: commissioner.client, path: { id: league.id } })).data);

    const currentSeasons = await prisma.sportLeague.findMany({ where: { isActive: true, currentSeasonId: { not: null } }, select: { currentSeason: { select: { championshipYear: true } } } });
    const earliestCurrentSeason = Math.min(...currentSeasons.map((row) => expectDefined(row.currentSeason).championshipYear));
    expect(await calendar()).toEqual({ currentYear: earliestCurrentSeason, years: [{ championshipYear: earliestCurrentSeason, isClosed: false, closesAfter: [], unfinishedContests: [] }] });

    const { contestId: openId } = await seedContestFixture(league.id, { name: 'Open 2026 pool', selectionType: SelectionType.TIERED });
    const later = await anySeason(prisma, 2027);
    const liveLater = await prisma.contest.create({ data: { leagueId: league.id, ...later, name: 'Live 2027 pool', status: 'ACTIVE', selectionType: 'TIERED' } });
    const opened = await calendar();
    expect(opened.currentYear).toBe(2027);
    expect(opened.years.map((year) => [year.championshipYear, year.isClosed, year.unfinishedContests])).toEqual([
      [2027, false, [{ contestId: liveLater.id, name: 'Live 2027 pool' }]],
      [2026, false, [{ contestId: openId, name: 'Open 2026 pool' }]],
    ]);

    await prisma.contest.update({ where: { id: liveLater.id }, data: { status: 'COMPLETED' } });
    expect((await calendar()).currentYear).toBe(2026);

    await prisma.leagueChampionshipYear.create({ data: { leagueId: league.id, championshipYear: 2026, closedAt: new Date() } });
    const closed = await calendar();
    expect(closed.currentYear).toBe(2027);
    expect(closed.years.find((year) => year.championshipYear === 2026)).toEqual({ championshipYear: 2026, isClosed: true, closesAfter: [], unfinishedContests: [] });

    expect((await getChampionshipCalendar({ client: outsider.client, path: { id: league.id } })).response?.status).toBe(403);
  });
});
