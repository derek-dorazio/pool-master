import type { CupContestRowDto, CupDto, CupStandingRowDto } from '@/lib/api';

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
