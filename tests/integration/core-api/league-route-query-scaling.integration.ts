/**
 * #1248 — a league's, a team's and a user's list reads cost the same SQL statements for 2 rows as
 * for 20, which keeps the audit's fixes to them fixed (#1176, #1182).
 *
 * Each case seeds one fresh league or user and scales one thing the read lists: its teams, a
 * team's owners, its invitations, its payments, or the users a search finds.
 * `rules/testing-rules.md` §9B *Query Scaling Tests* says when a route needs one.
 */
import { randomUUID } from 'crypto';
import { ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import {
  LeagueContextResponseSchema,
  LeaguePaymentListResponseSchema,
  ListLeagueInvitationsResponseSchema,
  SquadResponseSchema,
  TeamOwnerInvitationListResponseSchema,
  UserListResponseSchema,
  UserPaymentListResponseSchema,
} from '@poolmaster/shared/dto';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { DAY, get, okBody, seedLeagueWithTeams } from '../list-route-seeds';
import { expectDefined } from '../../support/expect-defined';
import { expectConstantQueries } from '../query-scaling';

// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** A league whose first team has `owners` owners, each a member with a user of their own. */
async function seedTeamWithOwners(owners: number) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(1);
  const squad = expectDefined(seeded.squads[0]);
  for (let index = 1; index < owners; index += 1) {
    const owner = await createTestUser({ displayName: `Scaling Owner ${seeded.suffix}${index}` });
    await prisma.leagueMembership.create({ data: { leagueId: seeded.league.id, userId: owner.user.id, role: 'MEMBER', status: 'ACTIVE' } });
    await prisma.squadMembership.create({ data: { squadId: squad.id, leagueId: seeded.league.id, userId: owner.user.id } });
  }
  return { ...seeded, squad };
}

/**
 * A league with `invitations` outstanding invitations, each sent by a commissioner of its own:
 * every other one an email invite whose invite email is queued, the rest join links.
 */
async function seedInvitations(invitations: number) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(0);
  for (let index = 0; index < invitations; index += 1) {
    const inviter = await createTestUser({ displayName: `Scaling Inviter ${seeded.suffix}${index}` });
    await prisma.leagueMembership.create({ data: { leagueId: seeded.league.id, userId: inviter.user.id, role: 'COMMISSIONER', status: 'ACTIVE' } });
    const email = index % 2 === 0 ? `invitee-${seeded.suffix}-${String(index)}@integration.test` : null;
    const invitation = await prisma.leagueInvitation.create({
      data: {
        leagueId: seeded.league.id,
        email,
        inviteCode: `SCALE-${randomUUID()}`,
        inviteType: email ? 'EMAIL' : 'LINK',
        maxUses: email ? 1 : 10,
        invitedBy: inviter.user.id,
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });
    if (email) {
      await prisma.emailMessage.create({
        data: {
          templateKey: 'LEAGUE_MEMBER_INVITE',
          recipientEmail: email,
          leagueId: seeded.league.id,
          invitationId: invitation.id,
          idempotencyKey: `scaling-invite-${invitation.id}`,
          fromName: 'Scaling',
          fromAddress: 'scaling@integration.test',
          status: 'SENT',
          sentAt: new Date(),
        },
      });
    }
  }
  return seeded;
}

/** A league with `invitations` pending co-owner invitations, each to a team of its own from that team's owner. */
async function seedOwnerInvitations(invitations: number) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(invitations);
  for (const [index, squad] of seeded.squads.entries()) {
    await prisma.squadOwnerInvitation.create({
      data: {
        leagueId: seeded.league.id,
        squadId: squad.id,
        email: `co-owner-${seeded.suffix}-${String(index)}@integration.test`,
        inviteCode: `SCALE-OWNER-${randomUUID()}`,
        invitedBy: squad.createdBy,
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });
  }
  return seeded;
}

/** One contest expansion paid by `payer` in `leagueId`, on a contest of its own. */
async function seedExpansionPayment(leagueId: string, payerId: string, name: string) {
  const prisma = getPrisma();
  const contest = await prisma.contest.create({
    data: { leagueId, seasonYear: new Date().getUTCFullYear(), name, status: ContestStatus.OPEN, contestFormat: 'ROSTER', selectionType: SelectionType.TIERED },
  });
  const payment = await prisma.leaguePayment.create({
    data: { leagueId, contestId: contest.id, payerId, kind: 'CONTEST_EXPANSION_PAYMENTS_OFF', amountCents: 0, description: `Expanded ${name}` },
  });
  await prisma.contestExpansion.create({ data: { contestId: contest.id, entriesPerContest: 50, paymentId: payment.id } });
}

/** A league with `payments` contest expansions, each paid by a commissioner of its own. */
async function seedLeaguePayments(payments: number) {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(0);
  for (let index = 0; index < payments; index += 1) {
    const payer = await createTestUser({ displayName: `Scaling Payer ${seeded.suffix}${index}` });
    await prisma.leagueMembership.create({ data: { leagueId: seeded.league.id, userId: payer.user.id, role: 'COMMISSIONER', status: 'ACTIVE' } });
    await seedExpansionPayment(seeded.league.id, payer.user.id, `Contest ${seeded.suffix} ${String(index)}`);
  }
  return seeded;
}

/** A user who paid for `payments` contest expansions, each in a league of its own that they run. */
async function seedUserPayments(payments: number) {
  const prisma = getPrisma();
  const payer = await createTestUser();
  for (let index = 0; index < payments; index += 1) {
    const { league, suffix } = await seedLeagueWithTeams(0);
    await prisma.leagueMembership.create({ data: { leagueId: league.id, userId: payer.user.id, role: 'COMMISSIONER', status: 'ACTIVE' } });
    await seedExpansionPayment(league.id, payer.user.id, `Contest ${suffix}`);
  }
  return payer;
}

/** A root admin, and `users` users whose names all hold one search term no other user has. */
async function seedUsersFound(users: number) {
  const term = `scaling${randomUUID().slice(0, 8)}`;
  for (let index = 0; index < users; index += 1) {
    await createTestUser({ firstName: term, lastName: `Member ${String(index)}` });
  }
  return { term, rootAdmin: await createTestUser({ isRootAdmin: true }) };
}

describe('league, team and user reads cost the same statements for 2 rows as for 20', () => {
  it('GET a league: the same statements for 2 teams as for 20 (#1176)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}',
      seed: seedLeagueWithTeams,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}`, commissioner),
      rowsShown: (response) => okBody(response, LeagueContextResponseSchema).activeTeamCount,
    });
  });

  it('GET a league by its code: the same statements for 2 teams as for 20 (#1176)', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/code/{leagueCode}',
      seed: seedLeagueWithTeams,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/code/${league.leagueCode}`, commissioner),
      rowsShown: (response) => okBody(response, LeagueContextResponseSchema).activeTeamCount,
    });
  });

  it("GET a league's invitations: the same statements for 2 invitations from 2 commissioners as for 20 from 20 (#1182)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/invitations',
      seed: seedInvitations,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/invitations`, commissioner),
      rowsShown: (response) => okBody(response, ListLeagueInvitationsResponseSchema).invitations.length,
    });
  });

  it("GET a league's co-owner invitations: the same statements for 2 teams' invitations as for 20 (#1182)", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/squads/owner-invitations',
      seed: seedOwnerInvitations,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/squads/owner-invitations`, commissioner),
      rowsShown: (response) => okBody(response, TeamOwnerInvitationListResponseSchema).invitations.length,
    });
  });

  it('GET a team: the same statements for 2 owners as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/squads/{squadId}',
      seed: seedTeamWithOwners,
      call: ({ league, squad, commissioner }) => get(`/api/v1/leagues/${league.id}/squads/${squad.id}`, commissioner),
      rowsShown: (response) => okBody(response, SquadResponseSchema).squad.members.length,
    });
  });

  it("GET a league's payments: the same statements for 2 expansions from 2 payers as for 20 from 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/leagues/{id}/billing/payments',
      seed: seedLeaguePayments,
      call: ({ league, commissioner }) => get(`/api/v1/leagues/${league.id}/billing/payments`, commissioner),
      rowsShown: (response) => okBody(response, LeaguePaymentListResponseSchema).payments.length,
    });
  });

  it("GET a user's payments: the same statements for 2 expansions in 2 leagues as for 20 in 20", async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/users/{userId}/payments',
      seed: seedUserPayments,
      call: (payer) => get(`/api/v1/users/${payer.user.id}/payments`, payer),
      rowsShown: (response) => okBody(response, UserPaymentListResponseSchema).payments.length,
    });
  });

  it('GET the users a search finds: the same statements for 2 users as for 20', async () => {
    await expectConstantQueries({
      route: 'GET /api/v1/users/',
      seed: seedUsersFound,
      call: ({ term, rootAdmin }) => get(`/api/v1/users/?search=${term}`, rootAdmin),
      rowsShown: (response) => okBody(response, UserListResponseSchema).users.length,
    });
  });
});
