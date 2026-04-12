import { describe, expect, it } from 'vitest';
import {
  getLeagueSelectorOptions,
  sortLeaguesForOverview,
} from './league-routing';

const leagues = [
  {
    id: 'league-active-member',
    leagueCode: 'ACTIVE1',
    name: 'Active Member League',
    visibility: 'PRIVATE',
    isActive: true,
    memberCount: 12,
    activeContestCount: 2,
    role: 'MEMBER',
    createdAt: '2026-04-10T12:00:00.000Z',
  },
  {
    id: 'league-inactive-member',
    leagueCode: 'INACTIVE1',
    name: 'Inactive Member League',
    visibility: 'PRIVATE',
    isActive: false,
    memberCount: 10,
    activeContestCount: 0,
    role: 'MEMBER',
    createdAt: '2026-04-09T12:00:00.000Z',
  },
  {
    id: 'league-inactive-commissioner',
    leagueCode: 'COMMOFF1',
    name: 'Inactive Commissioner League',
    visibility: 'PRIVATE',
    isActive: false,
    memberCount: 8,
    activeContestCount: 0,
    role: 'COMMISSIONER',
    createdAt: '2026-04-11T12:00:00.000Z',
  },
  {
    id: 'league-active-commissioner',
    leagueCode: 'COMMON1',
    name: 'Active Commissioner League',
    visibility: 'PRIVATE',
    isActive: true,
    memberCount: 14,
    activeContestCount: 3,
    role: 'COMMISSIONER',
    createdAt: '2026-04-12T12:00:00.000Z',
  },
];

describe('league routing helpers', () => {
  it('shows inactive leagues in the selector only for commissioner contexts', () => {
    expect(getLeagueSelectorOptions(leagues).map((league) => league.leagueCode)).toEqual([
      'COMMON1',
      'COMMOFF1',
      'ACTIVE1',
    ]);
  });

  it('sorts overview tiles with active leagues first, then commissioner priority', () => {
    expect(sortLeaguesForOverview(leagues).map((league) => league.leagueCode)).toEqual([
      'COMMON1',
      'ACTIVE1',
      'COMMOFF1',
      'INACTIVE1',
    ]);
  });
});
