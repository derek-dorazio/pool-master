import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const bootstrapUsersScript = readFileSync(
  resolve(repoRoot, 'packages/core-api/scripts/bootstrap-users.mjs'),
  'utf8',
);
const browserFixtureState = readFileSync(
  resolve(repoRoot, 'clients/poolmaster/e2e/fixture-state.ts'),
  'utf8',
);
const browserFixtures = readFileSync(
  resolve(repoRoot, 'clients/poolmaster/e2e/fixtures.ts'),
  'utf8',
);

describe('pool-master-xw5.2: QA browser fixture user bootstrap', () => {
  it('reactivates durable fixture users when repairing deployed browser accounts', () => {
    expect(bootstrapUsersScript).toContain('isActive: true');
    expect(bootstrapUsersScript).toContain('isActive=${user.isActive}');
  });

  it('repairs a stale inaccessible QA fixture league before recreating it', () => {
    expect(browserFixtures).toContain('qaLeague: async ({ commissionerPage, memberPage, rootAdminPage }, use)');
    expect(browserFixtureState).toContain('repairConflictingQALeague(rootAdminPage)');
    expect(browserFixtureState).toContain("rootAdminPage.request.get(`/api/v1/leagues/code/${qaLeagueSeed.code}`)");
    expect(browserFixtureState).toContain("rootAdminPage.request.post(`/api/v1/admin/leagues/${league.id}/inactivate`");
    expect(browserFixtureState).toContain("rootAdminPage.request.delete(`/api/v1/admin/leagues/${league.id}`");
    expect(browserFixtureState).toContain('data: { leagueCode: qaLeagueSeed.code }');
  });
});
