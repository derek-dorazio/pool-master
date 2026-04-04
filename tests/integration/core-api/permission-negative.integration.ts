/**
 * Negative-path coverage for permissions and unauthorized access.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner, member, and outsider users
 * - creates its own league and contest
 * - verifies non-commissioners cannot manage league invitations or members
 * - verifies non-members cannot enter a contest
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  ContestType,
  TierAssignmentMethod,
  LeagueVisibility,
  ScoringEngine,
  SelectionType,
  Sport,
} from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Permission Negative Integration', () => {
  let ownerHeaders: Record<string, string>;
  let memberHeaders: Record<string, string>;
  let outsiderHeaders: Record<string, string>;
  let ownerUserId: string;
  let leagueId: string;
  let contestId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Permission Owner' });
    const member = await createTestUser({ displayName: 'Permission Member' });
    const outsider = await createTestUser({ displayName: 'Permission Outsider' });

    ownerHeaders = owner.headers;
    memberHeaders = member.headers;
    outsiderHeaders = outsider.headers;
    ownerUserId = owner.user.id;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Permission Negative League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;

    const inviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: ownerHeaders,
      payload: {
        emails: [member.user.email],
      },
    });

    expect(inviteRes.statusCode).toBe(201);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: memberHeaders,
      payload: {
        inviteCode: inviteRes.json().sent[0].inviteCode,
      },
    });

    expect(acceptRes.statusCode).toBe(201);

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Permission Negative Contest',
        sport: Sport.GOLF,
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        selectionConfig: {
          rounds: 1,
          tierAssignmentMethod: TierAssignmentMethod.ODDS,
          tierConfig: [
            {
              tierId: 'tier-1',
              tierName: 'Tier 1',
              tierNumber: 1,
              picksFromTier: 1,
              participantIds: [],
            },
          ],
        },
      },
    });

    expect(contestRes.statusCode).toBe(201);
    contestId = contestRes.json().contest.id;
  });

  it('rejects non-commissioners on league management routes and non-members on contest entry routes', async () => {
    const inviteAsMemberRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: memberHeaders,
      payload: {
        emails: ['someone.else@example.com'],
      },
    });
    expect(inviteAsMemberRes.statusCode).toBe(403);

    const changeRoleRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.leagues.memberRole(leagueId, ownerUserId),
      headers: memberHeaders,
      payload: {
        role: 'VIEWER',
      },
    });
    expect(changeRoleRes.statusCode).toBe(403);

    const removeOwnerRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.leagues.removeMember(leagueId, ownerUserId),
      headers: withoutJsonBodyHeaders(memberHeaders),
    });
    expect(removeOwnerRes.statusCode).toBe(403);

    const outsiderEnterRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(outsiderHeaders),
    });
    expect(outsiderEnterRes.statusCode).toBe(400);
    expect(outsiderEnterRes.json().message).toContain('league member');
  });
});
