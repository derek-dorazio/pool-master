/**
 * Integration coverage for the league commissioner dashboard read model.
 *
 * This suite is intentionally self-contained:
 * - creates its own owner and invited member
 * - creates its own league and future contest
 * - seeds one pending invitation and one unresolved action item
 * - verifies the dashboard aggregates member count, pending invites,
 *   upcoming events, and action items from the live persistence layer
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  getPrisma,
  createTestUser,
  cleanupTestData,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  ContestType,
  LeagueVisibility,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('League Dashboard Read Integration', () => {
  let ownerHeaders: Record<string, string>;
  let ownerUserId: string;
  let invitedHeaders: Record<string, string>;
  let invitedUserId: string;
  let leagueId: string;
  let contestId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Dashboard Owner' });
    const invited = await createTestUser({ displayName: 'Dashboard Invitee' });
    ownerHeaders = owner.headers;
    ownerUserId = owner.user.id;
    invitedHeaders = invited.headers;
    invitedUserId = invited.user.id;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: {
        name: 'Dashboard League',
        visibility: LeagueVisibility.PRIVATE,
        maxMembers: 12,
      },
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;

    const pendingInviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: ownerHeaders,
      payload: {
        emails: [`pending-${randomUUID().slice(0, 8)}@integration.test`],
      },
    });
    expect(pendingInviteRes.statusCode).toBe(201);
    expect(pendingInviteRes.json().sent).toHaveLength(1);

    const emailInviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: ownerHeaders,
      payload: {
        emails: [invited.user.email],
      },
    });
    expect(emailInviteRes.statusCode).toBe(201);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: invitedHeaders,
      payload: {
        inviteCode: emailInviteRes.json().sent[0].inviteCode,
      },
    });
    expect(acceptRes.statusCode).toBe(201);

    const contestRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Dashboard Future Contest',
        sport: 'GOLF',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        startsAt: '2026-04-06T12:00:00.000Z',
        lockAt: '2026-04-06T13:00:00.000Z',
        endsAt: '2026-04-06T18:00:00.000Z',
        selectionConfig: {
          rounds: 1,
          tierAssignmentMethod: 'AUTO_ODDS',
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

    const prisma = getPrisma();
    await prisma.commissionerActionItem.create({
      data: {
        leagueId,
        contestId,
        type: 'CONTEST_ENDING',
        priority: 'HIGH',
        title: 'Contest ending soon',
        description: 'Review payout settings before the contest closes.',
        actionUrl: `/leagues/${leagueId}/contests/${contestId}`,
      },
    });
  });

  it('returns dashboard aggregates from the live league, contest, invite, and action-item data', async () => {
    const dashboardRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.detail(leagueId) + '/dashboard',
      headers: ownerHeaders,
    });

    expect(dashboardRes.statusCode).toBe(200);
    const dashboard = dashboardRes.json();
    expect(dashboard.league.id).toBe(leagueId);
    expect(dashboard.memberCount).toBe(2);
    expect(dashboard.pendingInvites).toBe(1);
    expect(dashboard.contests).toHaveLength(1);
    expect(dashboard.contests[0].id).toBe(contestId);
    expect(dashboard.upcomingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contestId, eventType: 'CONTEST_START' }),
        expect.objectContaining({ contestId, eventType: 'LOCK_TIME' }),
        expect.objectContaining({ contestId, eventType: 'CONTEST_END' }),
      ]),
    );
    expect(dashboard.actionItems).toHaveLength(1);
    expect(dashboard.actionItems[0]).toEqual(
      expect.objectContaining({
        leagueId,
        contestId,
        type: 'CONTEST_ENDING',
        priority: 'HIGH',
        resolved: false,
      }),
    );
    expect(dashboard.recentMemberActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: ownerUserId,
          displayName: ownerUserId,
          action: 'joined the league',
        }),
        expect.objectContaining({
          userId: invitedUserId,
          displayName: invitedUserId,
          action: 'joined the league',
        }),
      ]),
    );
  });
});
