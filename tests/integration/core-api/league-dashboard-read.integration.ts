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
  buildCreateLeaguePayload,
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  getPrisma,
  createTestUser,
  cleanupTestData,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  ContestFormat,
  ScoringEngine,
  SelectionType,
} from '@poolmaster/shared/domain';
import type {
  LeagueContextResponse,
  LeagueDashboardResponse,
  SendLeagueInvitationsResponse,
} from '@poolmaster/shared/dto';
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
      payload: buildCreateLeaguePayload('Dashboard League'),
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json<LeagueContextResponse>().league.id;

    const pendingInviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: ownerHeaders,
      payload: {
        emails: [`pending-${randomUUID().slice(0, 8)}@integration.test`],
      },
    });
    expect(pendingInviteRes.statusCode).toBe(201);
    expect(pendingInviteRes.json<SendLeagueInvitationsResponse>().sent).toHaveLength(1);

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
        inviteCode: emailInviteRes.json<SendLeagueInvitationsResponse>().sent[0].inviteCode,
      },
    });
    expect(acceptRes.statusCode).toBe(201);

    // #245 retired the event-less legacy create; the dashboard read needs only a future contest
    // row, so it is a fixture with the same shape that create used to write.
    const contest = await getPrisma().contest.create({
      data: {
        leagueId,
        name: 'Dashboard Future Contest',
        status: 'DRAFT',
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        scoringEngine: ScoringEngine.STROKE_PLAY,
        startsAt: new Date('2099-05-06T12:00:00.000Z'),
        endsAt: new Date('2099-05-06T18:00:00.000Z'),
      },
    });
    await getPrisma().contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: SelectionType.TIERED,
        maxEntriesPerSquad: 1,
      },
    });
    contestId = contest.id;
  });

  it('returns dashboard aggregates from the live league, contest, and invite data', async () => {
    const dashboardRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.leagues.detail(leagueId) + '/dashboard',
      headers: ownerHeaders,
    });

    expect(dashboardRes.statusCode).toBe(200);
    const dashboard = dashboardRes.json<LeagueDashboardResponse>();
    expect(dashboard.league.id).toBe(leagueId);
    expect(dashboard.memberCount).toBe(2);
    expect(dashboard.pendingInvites).toBe(1);
    expect(dashboard.contests).toHaveLength(1);
    expect(dashboard.contests[0].id).toBe(contestId);
    expect(dashboard.upcomingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contestId, eventType: 'CONTEST_START' }),
        expect.objectContaining({ contestId, eventType: 'CONTEST_END' }),
      ]),
    );
    // #205 dropped the action-item table, and the dashboard's `actionItems` with it.
    expect(dashboard).not.toHaveProperty('actionItems');
    expect(dashboard.recentMemberActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: ownerUserId,
          action: 'joined the league',
        }),
        expect.objectContaining({
          userId: invitedUserId,
          action: 'joined the league',
        }),
      ]),
    );
  });
});
