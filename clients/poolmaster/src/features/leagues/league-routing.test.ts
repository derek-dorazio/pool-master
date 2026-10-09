import { describe, expect, it } from 'vitest';
import type { LeagueDto, LeagueMembershipDto } from '@/lib/api';
import {
  buildLeagueContestPath,
  buildLeagueContestEntryPath,
  buildLeagueAdminContestsPath,
  buildLeagueContestsPath,
  buildLeagueHistoryPath,
  buildLeagueTeamHomePath,
  getCommissionerLeagueIds,
  getLeagueSelectorOptions,
} from './league-routing';
import {
  buildLeague,
  buildLeagueMembership,
} from './test/fixtures';

const leagues: LeagueDto[] = [
  buildLeague({
    id: 'league-active-member',
    leagueCode: 'ACTIVE1',
    name: 'Active Member League',
    memberCount: 12,
    activeContestCount: 2,
    createdAt: '2026-04-10T12:00:00.000Z',
  }),
  buildLeague({
    id: 'league-inactive-member',
    leagueCode: 'INACTIVE1',
    name: 'Inactive Member League',
    isActive: false,
    memberCount: 10,
    activeContestCount: 0,
    createdAt: '2026-04-09T12:00:00.000Z',
  }),
  buildLeague({
    id: 'league-inactive-commissioner',
    leagueCode: 'COMMOFF1',
    name: 'Inactive Commissioner League',
    isActive: false,
    memberCount: 8,
    activeContestCount: 0,
    createdAt: '2026-04-11T12:00:00.000Z',
  }),
  buildLeague({
    id: 'league-active-commissioner',
    leagueCode: 'COMMON1',
    name: 'Active Commissioner League',
    memberCount: 14,
    activeContestCount: 3,
    createdAt: '2026-04-12T12:00:00.000Z',
  }),
];

// #202 (A8) — which leagues the viewer commissions arrives beside the list, as their own
// memberships, rather than as a `leagueRelationship` block on each league.
const memberships: LeagueMembershipDto[] = [
  buildLeagueMembership({ id: 'm-1', leagueId: 'league-active-member', role: 'MEMBER' }),
  buildLeagueMembership({ id: 'm-2', leagueId: 'league-inactive-member', role: 'MEMBER' }),
  buildLeagueMembership({ id: 'm-3', leagueId: 'league-inactive-commissioner' }),
  buildLeagueMembership({ id: 'm-4', leagueId: 'league-active-commissioner' }),
];

describe('pool-master-rop.23: league routing generated DTO fixtures', () => {
  it('shows inactive leagues in the selector only for commissioner contexts', () => {
    const commissionerLeagueIds = getCommissionerLeagueIds(memberships);

    expect(
      getLeagueSelectorOptions(leagues, commissionerLeagueIds).map((league) => league.leagueCode),
    ).toEqual([
      'COMMON1',
      'COMMOFF1',
      'ACTIVE1',
    ]);
  });

  it('counts only an active commissioner membership as commissioning a league', () => {
    const commissionerLeagueIds = getCommissionerLeagueIds([
      ...memberships,
      buildLeagueMembership({ id: 'm-5', leagueId: 'league-active-member', status: 'INACTIVE' }),
    ]);

    expect([...commissionerLeagueIds].sort()).toEqual([
      'league-active-commissioner',
      'league-inactive-commissioner',
    ]);
  });

  it('pool-master-rop.23: builds canonical league-scoped paths for the reorganized IA', () => {
    expect(buildLeagueTeamHomePath('BIGDOGS', 'team-1')).toBe(
      '/league/BIGDOGS/teams/team-1',
    );
    expect(buildLeagueHistoryPath('BIGDOGS')).toBe('/league/BIGDOGS/history');
    expect(buildLeagueContestsPath('BIGDOGS')).toBe('/league/BIGDOGS/contests');
    expect(buildLeagueAdminContestsPath('BIGDOGS')).toBe(
      '/league/BIGDOGS/admin/contests',
    );
    expect(buildLeagueContestPath('BIGDOGS', 'contest-9')).toBe(
      '/league/BIGDOGS/contests/contest-9',
    );
    expect(buildLeagueContestEntryPath('BIGDOGS', 'contest-9', 'entry-2')).toBe(
      '/league/BIGDOGS/contests/contest-9/entries/entry-2',
    );
  });
});
