import { describe, expect, it } from 'vitest';
import { LeagueIconKey, LeagueRole } from '@poolmaster/shared/domain';
import type { ListLeaguesResponses } from '@/lib/api';
import {
  buildLeagueContestPath,
  buildLeagueContestsManagePath,
  buildLeagueContestsPath,
  buildLeagueEntriesPath,
  buildLeagueHistoryPath,
  buildLeagueTeamHomePath,
  getLeagueSelectorOptions,
  sortLeaguesForOverview,
} from './league-routing';

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

const leagues: LeagueSummary[] = [
  {
    id: 'league-active-member',
    leagueCode: 'ACTIVE1',
    name: 'Active Member League',
    isActive: true,
    iconKey: LeagueIconKey.TROPHY,
    memberCount: 12,
    activeContestCount: 2,
    role: LeagueRole.MEMBER,
    createdAt: '2026-04-10T12:00:00.000Z',
  },
  {
    id: 'league-inactive-member',
    leagueCode: 'INACTIVE1',
    name: 'Inactive Member League',
    isActive: false,
    iconKey: LeagueIconKey.TROPHY,
    memberCount: 10,
    activeContestCount: 0,
    role: LeagueRole.MEMBER,
    createdAt: '2026-04-09T12:00:00.000Z',
  },
  {
    id: 'league-inactive-commissioner',
    leagueCode: 'COMMOFF1',
    name: 'Inactive Commissioner League',
    isActive: false,
    iconKey: LeagueIconKey.TROPHY,
    memberCount: 8,
    activeContestCount: 0,
    role: LeagueRole.COMMISSIONER,
    createdAt: '2026-04-11T12:00:00.000Z',
  },
  {
    id: 'league-active-commissioner',
    leagueCode: 'COMMON1',
    name: 'Active Commissioner League',
    isActive: true,
    iconKey: LeagueIconKey.TROPHY,
    memberCount: 14,
    activeContestCount: 3,
    role: LeagueRole.COMMISSIONER,
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

  it('builds canonical league-scoped paths for the reorganized IA', () => {
    expect(buildLeagueTeamHomePath('BIGDOGS', 'team-1')).toBe(
      '/league/BIGDOGS/teams/team-1',
    );
    expect(buildLeagueEntriesPath('BIGDOGS')).toBe('/league/BIGDOGS/entries');
    expect(buildLeagueHistoryPath('BIGDOGS')).toBe('/league/BIGDOGS/history');
    expect(buildLeagueContestsPath('BIGDOGS')).toBe('/league/BIGDOGS/contests');
    expect(buildLeagueContestsManagePath('BIGDOGS')).toBe(
      '/league/BIGDOGS/contests/manage',
    );
    expect(buildLeagueContestPath('BIGDOGS', 'contest-9')).toBe(
      '/league/BIGDOGS/contests/contest-9',
    );
  });
});
