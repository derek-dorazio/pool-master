import { describe, expect, it } from 'vitest';
import {
  buildLeagueContestPath,
  buildLeagueContestEntryPath,
  buildLeagueContestsManagePath,
  buildLeagueContestsPath,
  buildLeagueHistoryPath,
  buildLeagueTeamHomePath,
  getLeagueSelectorOptions,
  sortLeaguesForOverview,
} from './league-routing';
import { buildLeagueSummary, type LeagueSummary } from './test/fixtures';

const leagues: LeagueSummary[] = [
  buildLeagueSummary({
    id: 'league-active-member',
    leagueCode: 'ACTIVE1',
    name: 'Active Member League',
    memberCount: 12,
    activeContestCount: 2,
    memberType: 'MEMBER',
    leagueRelationship: { leagueMember: true, commissioner: false },
    createdAt: '2026-04-10T12:00:00.000Z',
  }),
  buildLeagueSummary({
    id: 'league-inactive-member',
    leagueCode: 'INACTIVE1',
    name: 'Inactive Member League',
    isActive: false,
    memberCount: 10,
    activeContestCount: 0,
    memberType: 'MEMBER',
    leagueRelationship: { leagueMember: true, commissioner: false },
    createdAt: '2026-04-09T12:00:00.000Z',
  }),
  buildLeagueSummary({
    id: 'league-inactive-commissioner',
    leagueCode: 'COMMOFF1',
    name: 'Inactive Commissioner League',
    isActive: false,
    memberCount: 8,
    activeContestCount: 0,
    createdAt: '2026-04-11T12:00:00.000Z',
  }),
  buildLeagueSummary({
    id: 'league-active-commissioner',
    leagueCode: 'COMMON1',
    name: 'Active Commissioner League',
    memberCount: 14,
    activeContestCount: 3,
    createdAt: '2026-04-12T12:00:00.000Z',
  }),
];

describe('pool-master-rop.23: league routing generated DTO fixtures', () => {
  it('shows inactive leagues in the selector only for commissioner contexts', () => {
    expect(getLeagueSelectorOptions(leagues).map((league) => league.leagueCode)).toEqual([
      'COMMON1',
      'COMMOFF1',
      'ACTIVE1',
    ]);
  });

  it('pool-master-rop.23: sorts overview tiles with active leagues first, then commissioner priority', () => {
    expect(sortLeaguesForOverview(leagues).map((league) => league.leagueCode)).toEqual([
      'COMMON1',
      'ACTIVE1',
      'COMMOFF1',
      'INACTIVE1',
    ]);
  });

  it('pool-master-rop.23: builds canonical league-scoped paths for the reorganized IA', () => {
    expect(buildLeagueTeamHomePath('BIGDOGS', 'team-1')).toBe(
      '/league/BIGDOGS/teams/team-1',
    );
    expect(buildLeagueHistoryPath('BIGDOGS')).toBe('/league/BIGDOGS/history');
    expect(buildLeagueContestsPath('BIGDOGS')).toBe('/league/BIGDOGS/contests');
    expect(buildLeagueContestsManagePath('BIGDOGS')).toBe(
      '/league/BIGDOGS/contests/manage',
    );
    expect(buildLeagueContestPath('BIGDOGS', 'contest-9')).toBe(
      '/league/BIGDOGS/contests/contest-9',
    );
    expect(buildLeagueContestEntryPath('BIGDOGS', 'contest-9', 'entry-2')).toBe(
      '/league/BIGDOGS/contests/contest-9/entries/entry-2',
    );
  });
});
