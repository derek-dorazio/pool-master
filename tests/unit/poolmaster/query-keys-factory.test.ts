import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { QueryKeys } from '../../../clients/poolmaster/src/lib/query-keys';

describe('pool-master-rop.78.9: PoolMaster query key factory', () => {
  it('pool-master-rop.78.9: preserves representative TanStack Query key shapes', () => {
    expect(QueryKeys.sports.list).toEqual(['poolmaster', 'sports', 'list']);
    expect(QueryKeys.sports.detail('sport-1')).toEqual(['poolmaster', 'sports', 'sport-1']);
    expect(QueryKeys.sportEvents.list({ sport: 'GOLF' })).toEqual([
      'poolmaster',
      'sport-events',
      'GOLF',
    ]);
    expect(QueryKeys.sportEvents.list({ sport: 'GOLF', status: 'SCHEDULED' })).toEqual([
      'poolmaster',
      'sport-events',
      { sport: 'GOLF', status: 'SCHEDULED' },
    ]);
    expect(QueryKeys.sportEvents.detail('event-1')).toEqual([
      'poolmaster',
      'sport-events',
      'event-1',
    ]);
    expect(QueryKeys.contests.list({ leagueId: 'league-1' })).toEqual([
      'poolmaster',
      'league-contests',
      'league-1',
    ]);
    expect(QueryKeys.contests.detail('contest-1')).toEqual([
      'poolmaster',
      'contest',
      'contest-1',
    ]);
    expect(QueryKeys.contests.standings('contest-1')).toEqual([
      'poolmaster',
      'contest',
      'contest-1',
      'standings',
    ]);
    expect(QueryKeys.contestEntries.byContest('contest-1')).toEqual([
      'poolmaster',
      'contest-entries',
      'contest-1',
    ]);
    expect(QueryKeys.contestEntries.detail('entry-1')).toEqual([
      'poolmaster',
      'contest-entries',
      'entry-1',
    ]);
    expect(QueryKeys.contestEntries.me('contest-1')).toEqual([
      'poolmaster',
      'contest-entries',
      'contest-1',
      'me',
    ]);
    expect(QueryKeys.leagues.detail('league-1')).toEqual(['poolmaster', 'league', 'league-1']);
    expect(QueryKeys.leagues.dashboard('league-1')).toEqual([
      'poolmaster',
      'league',
      'league-1',
      'dashboard',
    ]);
    expect(QueryKeys.leagues.members('league-1')).toEqual([
      'poolmaster',
      'league-members',
      'league-1',
    ]);
    expect(QueryKeys.auth.me).toEqual(['poolmaster', 'auth', 'me']);
    expect(QueryKeys.users.detail('user-1')).toEqual([
      'poolmaster',
      'admin',
      'user-detail',
      'user-1',
    ]);
    expect(QueryKeys.rootAdmin.manageUsers).toEqual([
      'poolmaster',
      'root-admin',
      'manage-users',
    ]);
  });

  it('#134: the inline-queryKey rule is on for feature code and off for the factory itself', () => {
    // The rule's own logic is covered by RuleTester in eslint-rules/__tests__/.
    // What only the config can express is the scope: lib/query-keys.ts is where
    // key arrays are supposed to live, so the rule must be off exactly there.
    const repoRoot = join(__dirname, '../../..');

    function severityFor(relativePath: string): unknown {
      const result = spawnSync(
        'npx',
        ['eslint', '--print-config', relativePath],
        { cwd: repoRoot, encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      const config = JSON.parse(result.stdout) as { rules: Record<string, unknown> };
      return config.rules['poolmaster/no-inline-query-keys'];
    }

    expect(severityFor('clients/poolmaster/src/lib/query-keys.ts')).toBeUndefined();
    expect(severityFor('clients/poolmaster/src/lib/api.ts')).toEqual([2]);
  });
});
