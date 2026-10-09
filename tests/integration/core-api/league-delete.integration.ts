/**
 * Permanently deleting an inactive league, against a real database.
 *
 * The delete is one transaction over every league-owned table, and Postgres refuses it if any
 * row still references the league or one of its squads through a RESTRICT foreign key. A unit
 * test with a Prisma double cannot see that, so the delete is exercised here on a league that
 * carries each kind of league-owned record a commissioner can create.
 */
import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import type {
  LeagueContextResponse,
  SquadListResponse,
  TeamOwnerInvitationResponse,
} from '@poolmaster/shared/dto';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Deleting an inactive league', () => {
  it('deletes a league with its contests, invitations, memberships and teams, and keeps its members\' accounts', async () => {
    const commissioner = await createTestUser({ displayName: 'Delete Commissioner' });
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: commissioner.headers,
      payload: buildCreateLeaguePayload('Delete Me League'),
    });
    expect(leagueRes.statusCode).toBe(201);
    const { league } = leagueRes.json<LeagueContextResponse>();

    const squadsRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.squads.list(league.id),
      headers: commissioner.headers,
    });
    const squadId = squadsRes.json<SquadListResponse>().squads[0].id;

    // An address with no account, so the invitation stays PENDING and keeps its row.
    const inviteRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.squads.createOwnerInvitation(league.id, squadId),
      headers: commissioner.headers,
      payload: { email: `no-account-${league.id.slice(0, 8)}@integration.test` },
    });
    expect(inviteRes.statusCode).toBe(201);
    expect(inviteRes.json<TeamOwnerInvitationResponse>().invitation.status).toBe('PENDING');

    // A contest and a league invitation, so every league-owned table the delete clears has a row.
    await getPrisma().contest.create({
      data: { leagueId: league.id, name: 'Doomed Contest', selectionType: 'TIERED', scoringEngine: 'STROKE_PLAY' },
    });
    await getPrisma().leagueInvitation.create({
      data: { leagueId: league.id, inviteCode: `delete-${league.id.slice(0, 8)}`, invitedBy: commissioner.user.id },
    });

    const inactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.inactivate(league.id),
      headers: withoutJsonBodyHeaders(commissioner.headers),
    });
    expect(inactivateRes.statusCode).toBe(200);

    const deleteRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.leagues.detail(league.id),
      headers: commissioner.headers,
      payload: { leagueCode: league.leagueCode },
    });

    expect(deleteRes.statusCode).toBe(200);
    const prisma = getPrisma();
    await expect(prisma.league.findUnique({ where: { id: league.id } })).resolves.toBeNull();
    await expect(prisma.squadOwnerInvitation.count({ where: { leagueId: league.id } })).resolves.toBe(0);
    await expect(prisma.squad.count({ where: { leagueId: league.id } })).resolves.toBe(0);
    await expect(prisma.contest.count({ where: { leagueId: league.id } })).resolves.toBe(0);
    await expect(prisma.leagueInvitation.count({ where: { leagueId: league.id } })).resolves.toBe(0);
    await expect(prisma.leagueMembership.count({ where: { leagueId: league.id } })).resolves.toBe(0);
    // The league goes; its members' accounts do not.
    await expect(prisma.user.findUnique({ where: { id: commissioner.user.id } })).resolves.toMatchObject({ isActive: true });
  });
});
