import { randomUUID } from 'node:crypto';
import { ContestStatus, LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
import {
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaSquadMembershipRepository,
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
  const league = await prisma.league.create({ data: { leagueCode: `LSQ${suffix}`, name: `${label} ${suffix}` } });
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
  return new SquadOwnerInvitationService(
    new PrismaSquadOwnerInvitationRepository(prisma),
    new PrismaLeagueMembershipRepository(prisma),
    new PrismaSquadRepository(prisma),
    new PrismaSquadMembershipRepository(prisma),
    new PrismaUserRepository(prisma),
    prisma,
  );
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
        name: `Contest ${status}`,
        status,
        selectionType: 'TIERED' as const,
        scoringEngine: 'STROKE_PLAY' as const,
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
