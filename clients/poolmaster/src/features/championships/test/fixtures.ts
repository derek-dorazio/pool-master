import type { ChampionshipDto, ChampionshipStandingRowDto, ContestResultSummaryDto, CupContestRowDto, CupDto, CupProjectionDto, CupStandingRowDto } from '@/lib/api';

/** A cup standings row; points in tenths. */
export function buildCupStanding(overrides: Partial<CupStandingRowDto> = {}): CupStandingRowDto {
  return {
    squadId: 'team-1',
    squadName: 'Casey Crushers',
    squadIconKey: 'CAPTAIN_SMILE_FIELD',
    squadIsActive: true,
    position: 1,
    displayPosition: '1',
    points: 0,
    wins: 0,
    podiums: 0,
    contestsCounted: 0,
    movement: null,
    pointsAfter: [],
    trophy: null,
    ...overrides,
  };
}

export function buildCupContest(overrides: Partial<CupContestRowDto> = {}): CupContestRowDto {
  return {
    contestId: 'contest-1',
    name: 'Masters Tiers',
    status: 'COMPLETED',
    selectionType: 'TIERED',
    cupWeight: 'NORMAL',
    count: 'COUNTED',
    firstEventStartsAt: '2026-04-09T12:00:00.000Z',
    completedAt: '2026-04-13T22:00:00.000Z',
    winners: [],
    ...overrides,
  };
}

export function buildCup(overrides: Partial<CupDto> = {}): CupDto {
  return {
    id: 'cup-pga',
    leagueId: 'league-1',
    seasonYear: 2026,
    sportLeagueId: 'sport-league-pga',
    sportLeagueName: 'PGA Tour',
    name: '2026 PGA Tour Cup',
    status: 'OPEN',
    crownedAt: null,
    standings: [],
    contests: [],
    ...overrides,
  };
}

/**
 * A PGA Tour cup two contests in: Birdie Bandits lead, the viewer's Casey Crushers are 2nd, and
 * the Tour Championship is live.
 */
export function buildRunningCup(): CupDto {
  return buildCup({
    standings: [
      buildCupStanding({
        squadId: 'team-2', squadName: 'Birdie Bandits', position: 1, displayPosition: '1',
        points: 1800, wins: 1, podiums: 2, contestsCounted: 2, movement: 1, pointsAfter: [800, 1800],
      }),
      buildCupStanding({
        squadId: 'team-1', squadName: 'Casey Crushers', position: 2, displayPosition: '2',
        points: 1650, wins: 1, podiums: 2, contestsCounted: 2, movement: -1, pointsAfter: [1000, 1650],
      }),
      buildCupStanding({
        squadId: 'team-3', squadName: 'Bogey Men', position: 3, displayPosition: '3',
        points: 1350, podiums: 2, contestsCounted: 2, movement: 0, pointsAfter: [650, 1350],
      }),
    ],
    contests: [
      buildCupContest({ winners: [{ squadId: 'team-1', squadName: 'Casey Crushers' }] }),
      buildCupContest({
        contestId: 'contest-2', name: 'PGA Championship Budget', cupWeight: 'BONUS',
        firstEventStartsAt: '2026-05-14T12:00:00.000Z', completedAt: '2026-05-17T22:00:00.000Z',
        winners: [{ squadId: 'team-2', squadName: 'Birdie Bandits' }],
      }),
      buildCupContest({
        contestId: 'contest-3', name: 'Two of us side bet', cupWeight: 'NOT_COUNTED', count: 'NOT_COUNTED',
        firstEventStartsAt: '2026-05-20T12:00:00.000Z', completedAt: '2026-05-24T22:00:00.000Z',
      }),
      buildCupContest({
        contestId: 'contest-4', name: 'Tour Championship Tiers', status: 'ACTIVE', count: 'NOT_FINAL',
        firstEventStartsAt: '2026-08-27T12:00:00.000Z', completedAt: null,
      }),
    ],
  });
}

/**
 * The running cup if its live Tour Championship Tiers ended now: the viewer's Casey Crushers win
 * it and pass Birdie Bandits.
 */
export function buildRunningCupProjection(): CupProjectionDto {
  return {
    cupId: 'cup-pga',
    contests: [{ contestId: 'contest-4', name: 'Tour Championship Tiers', cupWeight: 'NORMAL' }],
    standings: [
      { squadId: 'team-1', position: 1, displayPosition: '1', points: 2650, gained: 1000, movement: 1 },
      { squadId: 'team-2', position: 2, displayPosition: '2', points: 2600, gained: 800, movement: -1 },
      { squadId: 'team-3', position: 3, displayPosition: '3', points: 2000, gained: 650, movement: 0 },
    ],
  };
}

export function buildChampionshipStanding(overrides: Partial<ChampionshipStandingRowDto> = {}): ChampionshipStandingRowDto {
  return {
    squadId: 'team-1',
    squadName: 'Casey Crushers',
    squadIconKey: 'CAPTAIN_SMILE_FIELD',
    squadIsActive: true,
    position: 1,
    displayPosition: '1',
    points: 0,
    finishes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    podiums: 0,
    topTens: 0,
    played: 0,
    ...overrides,
  };
}

/**
 * A 2026 championship three contests in, two to go: Birdie Bandits lead the viewer's Casey
 * Crushers by 15 points, with Fore Play 3rd.
 */
export function buildRunningChampionship(overrides: Partial<ChampionshipDto> = {}): ChampionshipDto {
  const bandits = { squadId: 'team-2', squadName: 'Birdie Bandits', squadIconKey: 'CAPTAIN_SMILE_SUNSET' as const };
  const crushers = { squadId: 'team-1', squadName: 'Casey Crushers', squadIconKey: 'CAPTAIN_SMILE_FIELD' as const };
  return {
    leagueId: 'league-1',
    year: 2026,
    cupName: 'Big Dawgs Cup',
    name: '2026 Big Dawgs Cup',
    isOver: false,
    contestsCounted: 3,
    contestsToGo: 2,
    standings: [
      buildChampionshipStanding({
        ...bandits, position: 1, displayPosition: '1', points: 2450,
        finishes: [2, 0, 1, 0, 0, 0, 0, 0, 0, 0], podiums: 3, topTens: 3, played: 3,
      }),
      buildChampionshipStanding({
        ...crushers, position: 2, displayPosition: '2', points: 2300,
        finishes: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0], podiums: 3, topTens: 3, played: 3,
      }),
      buildChampionshipStanding({
        squadId: 'team-3', squadName: 'Fore Play', squadIconKey: 'CAPTAIN_SMILE_SUNSET', position: 3, displayPosition: '3', points: 1950,
        finishes: [0, 1, 2, 0, 0, 0, 0, 0, 0, 0], podiums: 3, topTens: 3, played: 3,
      }),
    ],
    tiles: [
      { tile: 'MOST_FIRSTS', count: 2, squads: [bandits] },
      { tile: 'MOST_SECONDS', count: 2, squads: [crushers] },
      { tile: 'MOST_THIRDS', count: 2, squads: [{ squadId: 'team-3', squadName: 'Fore Play', squadIconKey: 'CAPTAIN_SMILE_SUNSET' }] },
      { tile: 'MOST_PODIUMS', count: 3, squads: [bandits, crushers] },
      { tile: 'MOST_TOP_TENS', count: 3, squads: [bandits, crushers] },
      { tile: 'MOST_PLAYED', count: 3, squads: [bandits, crushers] },
    ],
    ...overrides,
  };
}

/** A contest that went final in 2026: the Masters, won by Birdie Bandits from 12 entries. */
export function buildContestResult(overrides: Partial<ContestResultSummaryDto> = {}): ContestResultSummaryDto {
  return {
    contestId: 'contest-1',
    name: 'Masters Tiers',
    sportLeagueName: 'PGA Tour',
    selectionType: 'TIERED',
    completedAt: '2026-04-13T22:00:00.000Z',
    rankedEntryCount: 12,
    count: 'COUNTED',
    winners: [{ squadId: 'team-2', squadName: 'Birdie Bandits', squadIconKey: 'CAPTAIN_SMILE_SUNSET' }],
    squadFinish: null,
    ...overrides,
  };
}
