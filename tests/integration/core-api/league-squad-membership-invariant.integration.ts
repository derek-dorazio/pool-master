/**
 * The invariant that makes "the squad list is the member roster" true (#218).
 *
 *   Every ACTIVE LeagueMembership has exactly one ACTIVE SquadMembership in that league.
 *
 * It matters because the webapp has no separate member roster: `teams-page.tsx` lists squads with
 * their owners, and that IS how you see who is in a league. A member with no active squad is
 * invisible there while still holding league access.
 *
 * `removeOwner` used to break it — it ended the squad membership and left the league membership
 * ACTIVE. This suite asserts the invariant directly against the database after each way a
 * membership can begin or end, rather than trusting the two code paths that maintain it.
 */
import {
  buildCreateLeaguePayload,
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  getPrisma,
  createTestUser,
  cleanupTestData,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import type {
  ErrorEnvelope,
  LeagueContextResponse,
  SendLeagueInvitationsResponse,
  SquadListResponse,
  TeamOwnerInvitationResponse,
} from '@poolmaster/shared/dto';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

/**
 * Reads the invariant straight from the database for one league and returns every violation.
 * An empty array is the only passing result.
 */
async function findInvariantViolations(leagueId: string): Promise<string[]> {
  const prisma = getPrisma();
  const [leagueMemberships, squadMemberships] = await Promise.all([
    prisma.leagueMembership.findMany({ where: { leagueId, status: 'ACTIVE' } }),
    prisma.squadMembership.findMany({ where: { leagueId, status: 'ACTIVE' } }),
  ]);

  const activeSquadsByUser = new Map<string, number>();
  for (const membership of squadMemberships) {
    activeSquadsByUser.set(membership.userId, (activeSquadsByUser.get(membership.userId) ?? 0) + 1);
  }

  const violations: string[] = [];
  for (const membership of leagueMemberships) {
    const count = activeSquadsByUser.get(membership.userId) ?? 0;
    if (count !== 1) {
      violations.push(
        `active league member ${membership.userId} has ${count} active squad memberships, expected 1`,
      );
    }
  }
  // The other direction: an active squad membership for somebody who is not an active member.
  for (const [userId] of activeSquadsByUser) {
    if (!leagueMemberships.some((membership) => membership.userId === userId)) {
      violations.push(`user ${userId} owns an active squad without an active league membership`);
    }
  }
  return violations;
}

describe('League/squad membership invariant', () => {
  let commissionerHeaders: Record<string, string>;
  let memberHeaders: Record<string, string>;
  let memberUserId: string;
  let coOwnerHeaders: Record<string, string>;
  let coOwnerUserId: string;
  let coOwnerEmail: string;
  let leagueId: string;
  let commissionerSquadId: string;

  beforeAll(async () => {
    const commissioner = await createTestUser({ displayName: 'Invariant Commissioner' });
    const member = await createTestUser({ displayName: 'Invariant Member' });
    const coOwner = await createTestUser({ displayName: 'Invariant CoOwner' });
    commissionerHeaders = commissioner.headers;
    memberHeaders = member.headers;
    memberUserId = member.user.id;
    coOwnerHeaders = coOwner.headers;
    coOwnerUserId = coOwner.user.id;
    coOwnerEmail = coOwner.user.email;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: commissionerHeaders,
      payload: buildCreateLeaguePayload('Invariant League'),
    });
    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json<LeagueContextResponse>().league.id;

    const squadsRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.squads.list(leagueId),
      headers: commissionerHeaders,
    });
    expect(squadsRes.statusCode).toBe(200);
    commissionerSquadId = squadsRes.json<SquadListResponse>().squads[0].id;
  });

  it('holds after league creation provisions the creator a squad', async () => {
    // League creation is one of the two paths that create a membership, and it provisions the
    // default squad in the same unit.
    await expect(findInvariantViolations(leagueId)).resolves.toEqual([]);
  });

  it('holds after a member joins by league invitation and is given their own squad', async () => {
    const memberEmail = (await getPrisma().user.findUniqueOrThrow({ where: { id: memberUserId } })).email;
    const inviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: commissionerHeaders,
      payload: { emails: [memberEmail] },
    });
    expect(inviteRes.statusCode).toBe(201);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: memberHeaders,
      payload: { inviteCode: inviteRes.json<SendLeagueInvitationsResponse>().sent[0].inviteCode },
    });
    expect(acceptRes.statusCode).toBe(201);

    await expect(findInvariantViolations(leagueId)).resolves.toEqual([]);
  });

  it('refuses to make an existing league member a co-owner of another squad', async () => {
    // Worth asserting because it constrains the whole model: `SquadMembership` is unique on
    // (leagueId, userId), so a member already holding their own squad cannot join a second one.
    // Co-ownership therefore only arises for somebody who joins the league THROUGH a squad-owner
    // invitation — which is why `rejectIfCurrentLeagueMember` guards that flow.
    const addRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.squads.addMember(leagueId, commissionerSquadId),
      headers: commissionerHeaders,
      payload: { userId: memberUserId },
    });
    expect(addRes.statusCode).toBe(400);
    expect(addRes.json<ErrorEnvelope>().error.code).toBe('SQUAD_MEMBERSHIP_CONFLICT');

    await expect(findInvariantViolations(leagueId)).resolves.toEqual([]);
  });

  it('holds after a co-owner is removed from a squad — the case that used to break it', async () => {
    /*
     * A real co-owner: invited to the commissioner's squad while not yet in the league, so they
     * never get a squad of their own. That is the only way two people share one squad.
     *
     * Note what `inviteOwner` does here: because this email already belongs to a PoolMaster user,
     * it provisions them onto the squad immediately and returns the invitation already ACCEPTED.
     * The pending-then-accept path exists only for an email with no account behind it — which is
     * exactly the gap #217 covers.
     */
    const ownerInviteRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.squads.createOwnerInvitation(leagueId, commissionerSquadId),
      headers: commissionerHeaders,
      payload: { email: coOwnerEmail },
    });
    expect(ownerInviteRes.statusCode).toBe(201);
    expect(ownerInviteRes.json<TeamOwnerInvitationResponse>().invitation.status).toBe('ACCEPTED');
    await expect(findInvariantViolations(leagueId)).resolves.toEqual([]);

    const removeRes = await getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.squads.removeMember(leagueId, commissionerSquadId, coOwnerUserId),
      headers: withoutJsonBodyHeaders(commissionerHeaders),
    });
    expect(removeRes.statusCode).toBe(200);

    // Before #218 this left an ACTIVE league membership with zero active squads.
    await expect(findInvariantViolations(leagueId)).resolves.toEqual([]);

    const leagueMembership = await getPrisma().leagueMembership.findFirstOrThrow({
      where: { leagueId, userId: coOwnerUserId },
    });
    expect(leagueMembership.status).toBe('INACTIVE');
  });

  it('leaves the removed co-owner able to sign in, so a re-invite can restore them', async () => {
    const user = await getPrisma().user.findUniqueOrThrow({ where: { id: coOwnerUserId } });

    // The account is untouched by league/squad management (#218). `login` refuses an inactive
    // account and accepting an invitation needs a session, so deactivating here would make the
    // documented recovery path impossible.
    expect(user.isActive).toBe(true);

    // Refresh tokens are not asserted here: this harness mints access tokens directly rather
    // than going through `login`, so there are none to revoke. The FAPI suite exercises the real
    // login flow; `isActive` is the condition that gates it.
  });

  it('restores the original squad on re-invite, and the invariant holds again', async () => {
    const user = await getPrisma().user.findUniqueOrThrow({ where: { id: coOwnerUserId } });
    const squadMembershipBefore = await getPrisma().squadMembership.findFirstOrThrow({
      where: { leagueId, userId: coOwnerUserId },
    });

    const inviteRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/invitations`,
      headers: commissionerHeaders,
      payload: { emails: [user.email] },
    });
    expect(inviteRes.statusCode).toBe(201);

    const acceptRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.invitations.accept,
      headers: coOwnerHeaders,
      payload: { inviteCode: inviteRes.json<SendLeagueInvitationsResponse>().sent[0].inviteCode },
    });
    expect(acceptRes.statusCode).toBe(201);

    await expect(findInvariantViolations(leagueId)).resolves.toEqual([]);

    // Reactivated, not duplicated: `SquadMembership` is unique on (leagueId, userId), and
    // `ensureDefaultSquadForLeagueMember` reactivates the historical row and its squad. So the
    // rejoining member gets their original team back rather than a second one.
    const squadMembershipAfter = await getPrisma().squadMembership.findFirstOrThrow({
      where: { leagueId, userId: coOwnerUserId },
    });
    expect(squadMembershipAfter.id).toBe(squadMembershipBefore.id);
    expect(squadMembershipAfter.status).toBe('ACTIVE');
  });

  it('holds after a squad is inactivated, which ends every owner\'s league membership', async () => {
    // The member's team, not the commissioner's: the league's only commissioner may not
    // inactivate their own team, since that would leave nobody to run the league.
    const memberSquadId = (
      await getPrisma().squadMembership.findFirstOrThrow({ where: { leagueId, userId: memberUserId } })
    ).squadId;
    const inactivateRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.squads.inactivate(leagueId, memberSquadId),
      headers: withoutJsonBodyHeaders(commissionerHeaders),
    });
    expect(inactivateRes.statusCode).toBe(200);

    await expect(findInvariantViolations(leagueId)).resolves.toEqual([]);
  });
});
