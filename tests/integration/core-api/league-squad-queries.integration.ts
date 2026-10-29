import { randomUUID } from 'node:crypto';
import type { MembershipRepositories } from '@poolmaster/shared/db';
import {
  ContestStatus,
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
} from '@poolmaster/shared/domain';
import {
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaSquadMembershipRepository,
  PrismaMembershipTransaction,
  PrismaSquadOwnerInvitationRepository,
  PrismaSquadRepository,
  PrismaUserRepository,
} from '../../../packages/core-api/src/adapters';
import { LeagueService } from '../../../packages/core-api/src/modules/leagues/service';
import {
  SquadOwnerInvitationNotFoundError,
  SquadOwnerInvitationService,
} from '../../../packages/core-api/src/modules/squads/owner-invitation-service';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { emailServiceInto } from '../../support/email-service';

// League and squad reads that only the HTTP contract tests reached before (#508): what each
// query returns from Postgres, and which rows its filters leave out.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(async () => {
  await cleanupTestData();
});

/** A league whose commissioner is a test user, so cleanupTestData sweeps it. */
async function createLeague(label: string) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const commissioner = await createTestUser({ displayName: `${label} ${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Test Cup', leagueCode: `LSQ${suffix}`, name: `${label} ${suffix}` } });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: commissioner.user.id, role: LeagueRole.COMMISSIONER, status: LeagueMembershipStatus.ACTIVE },
  });
  return { league, commissioner: commissioner.user };
}

function leagueService() {
  const prisma = getPrisma();
  return new LeagueService({
    leagues: new PrismaLeagueRepository(prisma),
    memberships: new PrismaLeagueMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    prisma,
  });
}

function ownerInvitationService() {
  const prisma = getPrisma();
  return new SquadOwnerInvitationService({
    squadOwnerInvitations: new PrismaSquadOwnerInvitationRepository(prisma),
    leagueMemberships: new PrismaLeagueMembershipRepository(prisma),
    squads: new PrismaSquadRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    users: new PrismaUserRepository(prisma),
    prisma,
    memberJoined: { tellJoined: async () => undefined },
    membershipTransaction: new PrismaMembershipTransaction(prisma),
    email: emailServiceInto(),
    appBaseUrl: 'https://app.example.test',
  });
}

describe('LeagueService.countLeagueActivity', () => {
  it('counts active members and only OPEN and ACTIVE contests per league', async () => {
    const prisma = getPrisma();
    const busy = await createLeague('Busy');
    const quiet = await createLeague('Quiet');
    const member = await createTestUser();
    const removed = await createTestUser();
    await prisma.leagueMembership.createMany({
      data: [
        { leagueId: busy.league.id, userId: member.user.id, role: LeagueRole.MEMBER, status: LeagueMembershipStatus.ACTIVE },
        { leagueId: busy.league.id, userId: removed.user.id, role: LeagueRole.MEMBER, status: LeagueMembershipStatus.INACTIVE },
      ],
    });
    const statuses = [
      ContestStatus.DRAFT,
      ContestStatus.OPEN,
      ContestStatus.ACTIVE,
      ContestStatus.COMPLETED,
    ];
    await prisma.contest.createMany({
      data: statuses.map((status) => ({
        leagueId: busy.league.id,
        seasonYear: 2026,
        name: `Contest ${status}`,
        status,
        selectionType: 'TIERED' as const,
      })),
    });

    const { memberCounts, activeContestCounts } = await leagueService()
      .countLeagueActivity([busy.league.id, quiet.league.id]);

    expect(memberCounts).toEqual(new Map([[busy.league.id, 2], [quiet.league.id, 1]]));
    // A league with no active contest is absent, not zero; the caller defaults it.
    expect(activeContestCounts).toEqual(new Map([[busy.league.id, 2]]));
  });

  it('answers empty maps for no leagues without querying', async () => {
    await expect(leagueService().countLeagueActivity([])).resolves.toEqual({
      memberCounts: new Map(),
      activeContestCounts: new Map(),
    });
  });
});

describe('Team-owner invitations', () => {
  async function createInvitation() {
    const prisma = getPrisma();
    const { league, commissioner } = await createLeague('Invites');
    const squad = await prisma.squad.create({
      data: { leagueId: league.id, createdBy: commissioner.id, name: 'Invited Team', iconKey: 'CAPTAIN_SMILE_OCEAN' },
    });
    const invitation = await prisma.squadOwnerInvitation.create({
      data: {
        leagueId: league.id,
        squadId: squad.id,
        email: `owner-${randomUUID().slice(0, 8)}@integration.test`,
        inviteCode: `LSQ-${randomUUID()}`,
        invitedBy: commissioner.id,
      },
    });
    return { league, squad, invitation };
  }

  it('reads an invitation by id, and null for an unknown id', async () => {
    const { invitation, squad } = await createInvitation();
    const repo = new PrismaSquadOwnerInvitationRepository(getPrisma());

    await expect(repo.findById(invitation.id)).resolves.toEqual(expect.objectContaining({
      id: invitation.id,
      squadId: squad.id,
      status: 'PENDING',
    }));
    await expect(repo.findById(randomUUID())).resolves.toBeNull();
  });

  it('revokes only the team\'s pending invitations in one write and answers how many, leaving accepted ones and other teams\' alone (#1182)', async () => {
    const prisma = getPrisma();
    const { league, squad, invitation: pending } = await createInvitation();
    const otherSquad = await prisma.squad.create({
      data: { leagueId: league.id, createdBy: pending.invitedBy, name: 'Other Invited Team' },
    });
    const invite = (squadId: string, status: SquadOwnerInvitationStatus) => prisma.squadOwnerInvitation.create({
      data: {
        leagueId: league.id,
        squadId,
        email: `owner-${randomUUID().slice(0, 8)}@integration.test`,
        inviteCode: `LSQ-${randomUUID()}`,
        invitedBy: pending.invitedBy,
        status,
      },
    });
    const secondPending = await invite(squad.id, SquadOwnerInvitationStatus.PENDING);
    const accepted = await invite(squad.id, SquadOwnerInvitationStatus.ACCEPTED);
    const otherTeams = await invite(otherSquad.id, SquadOwnerInvitationStatus.PENDING);

    await expect(new PrismaSquadOwnerInvitationRepository(prisma).revokePendingBySquad(squad.id)).resolves.toBe(2);

    const statuses = new Map((await prisma.squadOwnerInvitation.findMany({ where: { leagueId: league.id } }))
      .map((row) => [row.id, row.status]));
    expect(statuses).toEqual(new Map([
      [pending.id, SquadOwnerInvitationStatus.REVOKED],
      [secondPending.id, SquadOwnerInvitationStatus.REVOKED],
      [accepted.id, SquadOwnerInvitationStatus.ACCEPTED],
      [otherTeams.id, SquadOwnerInvitationStatus.PENDING],
    ]));
  });

  it('previews an invitation by code with its league and team, and refuses an unknown code', async () => {
    const { league, squad, invitation } = await createInvitation();

    const preview = await ownerInvitationService().getInvitationPreview(invitation.inviteCode);

    expect(preview).toEqual(expect.objectContaining({
      inviteCode: invitation.inviteCode,
      status: 'PENDING',
      league: { id: league.id, leagueCode: league.leagueCode, name: league.name },
      team: { id: squad.id, name: 'Invited Team', iconKey: 'CAPTAIN_SMILE_OCEAN' },
    }));
    await expect(ownerInvitationService().getInvitationPreview('no-such-code'))
      .rejects.toBeInstanceOf(SquadOwnerInvitationNotFoundError);
  });
});

describe('PrismaMembershipTransaction', () => {
  /** A member who owns a team alone, with one pending co-owner invitation on it. */
  async function memberWithTeamAndInvitation() {
    const prisma = getPrisma();
    const { league, commissioner } = await createLeague('Membership Tx');
    const member = (await createTestUser({ displayName: `Member ${randomUUID().slice(0, 8)}` })).user;
    const membership = await prisma.leagueMembership.create({
      data: { leagueId: league.id, userId: member.id, role: LeagueRole.MEMBER, status: LeagueMembershipStatus.ACTIVE },
    });
    const squad = await prisma.squad.create({
      data: { leagueId: league.id, name: `Tx Team ${randomUUID().slice(0, 8)}`, createdBy: member.id },
    });
    const squadMembership = await prisma.squadMembership.create({
      data: { leagueId: league.id, squadId: squad.id, userId: member.id, status: SquadMembershipStatus.ACTIVE },
    });
    const invitation = await prisma.squadOwnerInvitation.create({
      data: {
        leagueId: league.id,
        squadId: squad.id,
        email: `owner-${randomUUID().slice(0, 8)}@integration.test`,
        inviteCode: `LSQ-${randomUUID()}`,
        invitedBy: commissioner.id,
      },
    });
    return { membership, squad, squadMembership, invitation };
  }

  /** Ends the membership, the team ownership, the team and its invitation, all through `repos`. */
  async function endEverything(repos: MembershipRepositories, seeded: Awaited<ReturnType<typeof memberWithTeamAndInvitation>>) {
    await repos.leagueMemberships.update(seeded.membership.id, { status: LeagueMembershipStatus.INACTIVE });
    await repos.squadMemberships.update(seeded.squadMembership.id, { status: SquadMembershipStatus.INACTIVE });
    await repos.squads.update(seeded.squad.id, { isActive: false });
    await repos.squadOwnerInvitations.update(seeded.invitation.id, { status: SquadOwnerInvitationStatus.REVOKED });
  }

  async function stored(seeded: Awaited<ReturnType<typeof memberWithTeamAndInvitation>>) {
    const prisma = getPrisma();
    return {
      membership: (await prisma.leagueMembership.findUniqueOrThrow({ where: { id: seeded.membership.id } })).status,
      squadMembership: (await prisma.squadMembership.findUniqueOrThrow({ where: { id: seeded.squadMembership.id } })).status,
      squadActive: (await prisma.squad.findUniqueOrThrow({ where: { id: seeded.squad.id } })).isActive,
      invitation: (await prisma.squadOwnerInvitation.findUniqueOrThrow({ where: { id: seeded.invitation.id } })).status,
    };
  }

  it('commits writes to all four membership tables when the work resolves', async () => {
    const seeded = await memberWithTeamAndInvitation();

    await new PrismaMembershipTransaction(getPrisma()).run((repos) => endEverything(repos, seeded));

    expect(await stored(seeded)).toEqual({
      membership: LeagueMembershipStatus.INACTIVE,
      squadMembership: SquadMembershipStatus.INACTIVE,
      squadActive: false,
      invitation: SquadOwnerInvitationStatus.REVOKED,
    });
  });

  it('rolls back every write in all four tables when the work throws after making them', async () => {
    const seeded = await memberWithTeamAndInvitation();

    await expect(new PrismaMembershipTransaction(getPrisma()).run(async (repos) => {
      await endEverything(repos, seeded);
      throw new Error('fails after the last write');
    })).rejects.toThrow('fails after the last write');

    expect(await stored(seeded)).toEqual({
      membership: LeagueMembershipStatus.ACTIVE,
      squadMembership: SquadMembershipStatus.ACTIVE,
      squadActive: true,
      invitation: SquadOwnerInvitationStatus.PENDING,
    });
  });
});

// #1165 — a squad read with its owners, which the team list and a team page use instead of
// reading the squad, its memberships and every user in the league per team.
describe('PrismaSquadRepository squad details', () => {
  async function createSquad(leagueId: string, name: string, createdBy: string, isActive = true) {
    return getPrisma().squad.create({ data: { leagueId, name, createdBy, isActive } });
  }

  async function addOwner(squadId: string, leagueId: string, userId: string, joinedAt: Date, status: SquadMembershipStatus = SquadMembershipStatus.ACTIVE) {
    await getPrisma().leagueMembership.upsert({
      where: { leagueId_userId: { leagueId, userId } },
      create: { leagueId, userId, role: LeagueRole.MEMBER, status: LeagueMembershipStatus.ACTIVE },
      update: {},
    });
    return getPrisma().squadMembership.create({ data: { squadId, leagueId, userId, status, joinedAt } });
  }

  it('reads every team in the league, active and inactive, oldest first, each with its owners in join order and their users', async () => {
    const { league, commissioner } = await createLeague('Details');
    const other = await createLeague('Other');
    const coOwner = await createTestUser();
    const leftOwner = await createTestUser();
    const first = await createSquad(league.id, 'First Team', commissioner.id);
    const second = await createSquad(league.id, 'Retired Team', commissioner.id, false);
    await createSquad(other.league.id, 'Other League Team', other.commissioner.id);
    await addOwner(first.id, league.id, coOwner.user.id, new Date('2026-04-02T00:00:00Z'));
    await addOwner(first.id, league.id, commissioner.id, new Date('2026-04-01T00:00:00Z'));
    await addOwner(second.id, league.id, leftOwner.user.id, new Date('2026-04-03T00:00:00Z'), SquadMembershipStatus.INACTIVE);

    const details = await new PrismaSquadRepository(getPrisma()).findDetailsByLeague(league.id);

    expect(details.map((squad) => [squad.name, squad.isActive])).toEqual([['First Team', true], ['Retired Team', false]]);
    expect(details[0]?.members.map(({ membership, user }) => [membership.userId, user.id])).toEqual([
      [commissioner.id, commissioner.id],
      [coOwner.user.id, coOwner.user.id],
    ]);
    expect(details[1]?.members.map(({ membership }) => membership.status)).toEqual([SquadMembershipStatus.INACTIVE]);
    // The embedded user is the domain User, which never carries the password hash.
    expect(details[0]?.members[0]?.user).not.toHaveProperty('passwordHash');
    expect(details[0]?.members[0]?.user.email).toBe(commissioner.email);
  });

  it('reads one team with its owners by id, and null for an unknown id', async () => {
    const { league, commissioner } = await createLeague('One');
    const squad = await createSquad(league.id, 'Only Team', commissioner.id);
    await addOwner(squad.id, league.id, commissioner.id, new Date('2026-04-01T00:00:00Z'));
    const repo = new PrismaSquadRepository(getPrisma());

    const details = await repo.findDetailsById(squad.id);

    expect(details?.name).toBe('Only Team');
    expect(details?.members.map(({ user }) => user.id)).toEqual([commissioner.id]);
    expect(await repo.findDetailsById(randomUUID())).toBeNull();
  });

  it('reads a user\'s squad membership in a league with its squad\'s name, and null for a member who owns none', async () => {
    const { league, commissioner } = await createLeague('Mine');
    const noTeam = await createTestUser();
    const squad = await createSquad(league.id, 'Commissioner Team', commissioner.id);
    await addOwner(squad.id, league.id, commissioner.id, new Date('2026-04-01T00:00:00Z'));
    const repo = new PrismaSquadMembershipRepository(getPrisma());

    const edge = await repo.findByLeagueAndUserWithSquadName(league.id, commissioner.id);

    expect(edge?.squadId).toBe(squad.id);
    expect(edge?.squadName).toBe('Commissioner Team');
    expect(await repo.findByLeagueAndUserWithSquadName(league.id, noTeam.user.id)).toBeNull();
  });

  it('counts only the league\'s active teams', async () => {
    const { league, commissioner } = await createLeague('Count');
    const other = await createLeague('Elsewhere');
    await createSquad(league.id, 'Active One', commissioner.id);
    await createSquad(league.id, 'Active Two', commissioner.id);
    await createSquad(league.id, 'Inactive', commissioner.id, false);
    await createSquad(other.league.id, 'Other League', other.commissioner.id);

    expect(await new PrismaSquadRepository(getPrisma()).countActiveByLeague(league.id)).toBe(2);
  });
});

describe('PrismaUserRepository.findByIds', () => {
  it('reads every user named in one call, leaving out an id with no user, and reads nothing for no ids', async () => {
    const users = new PrismaUserRepository(getPrisma());
    const [first, second] = await Promise.all([
      createTestUser({ displayName: `Receipt Owner ${randomUUID().slice(0, 8)}` }),
      createTestUser({ displayName: `Receipt Co-owner ${randomUUID().slice(0, 8)}` }),
    ]);

    const found = await users.findByIds([first.user.id, second.user.id, randomUUID()]);

    expect(found.map((user) => user.id).sort()).toEqual([first.user.id, second.user.id].sort());
    await expect(users.findByIds([])).resolves.toEqual([]);
  });
});
