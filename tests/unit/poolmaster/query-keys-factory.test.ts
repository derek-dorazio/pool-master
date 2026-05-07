import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueryKeys } from '../../../clients/poolmaster/src/lib/query-keys';

describe('pool-master-rop.78.9: PoolMaster query key factory', () => {
  it('pool-master-rop.78.9: preserves representative TanStack Query key shapes', () => {
    expect(QueryKeys.sports.list).toEqual(['poolmaster', 'sports']);
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
  });

  it('pool-master-rop.78.9: rules check flags synthetic inline queryKey arrays', () => {
    const repoRoot = join(__dirname, '../../..');
    const tempRoot = mkdtempSync(join(tmpdir(), 'poolmaster-query-keys-'));
    const featureDir = join(tempRoot, 'clients/poolmaster/src/features/demo');
    const libDir = join(tempRoot, 'clients/poolmaster/src/lib');

    try {
      mkdirSync(featureDir, { recursive: true });
      mkdirSync(libDir, { recursive: true });
      writeFileSync(
        join(featureDir, 'inline-query-key.tsx'),
        "export const violation = { queryKey: ['poolmaster', 'inline'] };\n",
      );
      writeFileSync(
        join(libDir, 'query-keys.ts'),
        "export const allowed = { queryKey: ['poolmaster', 'allowed'] };\n",
      );

      const result = spawnSync(
        process.execPath,
        [join(repoRoot, 'scripts/check-no-inline-query-keys.mjs')],
        {
          cwd: tempRoot,
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('inline-query-key.tsx:1');
      expect(result.stdout).toContain('Inline queryKey array');
      expect(result.stdout).not.toContain('allowed');
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});
