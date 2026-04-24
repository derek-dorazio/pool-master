import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadOwnerInvitationRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadOwnerInvitationStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import {
  SquadOwnerInvitationService,
} from '../../../packages/core-api/src/modules/squads/owner-invitation-service';

function createMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn(),
    findByUser: jest.fn(),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'membership-new',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      leagueId: 'league-1',
      userId: 'user-2',
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...updates,
    })),
    delete: jest.fn(),
    ...overrides,
  };
}

function createSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return {
    findById: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: 'Beer Bellies',
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    findByLeague: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: 'Beer Bellies',
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    delete: jest.fn(),
    ...overrides,
  };
}

function createSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return {
    findBySquad: jest.fn().mockResolvedValue([]),
    findBySquadAndUser: jest.fn().mockResolvedValue(null),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'squad-membership-new',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      squadId: 'squad-1',
      leagueId: 'league-1',
      userId: 'user-2',
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...updates,
    })),
    delete: jest.fn(),
    ...overrides,
  };
}

function createInvitationRepo(
  overrides: Partial<SquadOwnerInvitationRepository> = {},
): SquadOwnerInvitationRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByLeague: jest.fn().mockResolvedValue([]),
    findByCode: jest.fn().mockResolvedValue(null),
    findPendingByLeagueAndEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'invite-1',
      createdAt: new Date('2026-04-16T00:00:00Z'),
      updatedAt: new Date('2026-04-16T00:00:00Z'),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      leagueId: 'league-1',
      squadId: 'squad-1',
      email: 'invitee@example.com',
      inviteCode: 'invite-code',
      status: SquadOwnerInvitationStatus.ACCEPTED,
      invitedBy: 'user-1',
      createdAt: new Date('2026-04-16T00:00:00Z'),
      updatedAt: new Date('2026-04-16T00:00:00Z'),
      ...updates,
    })),
    delete: jest.fn(),
    ...overrides,
  };
}

function createPrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    league: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
      }),
    },
    ...overrides,
  } as any;
}

describe('SquadOwnerInvitationService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('rejects inviting an email that already belongs to a current league member', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockImplementation(async (_leagueId: string, userId: string) => {
        if (userId === 'user-1') {
          return {
            id: 'actor-membership',
            leagueId: 'league-1',
            userId: 'user-1',
            role: LeagueRole.COMMISSIONER,
            status: LeagueMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        if (userId === 'user-2') {
          return {
            id: 'target-membership',
            leagueId: 'league-1',
            userId: 'user-2',
            role: LeagueRole.MEMBER,
            status: LeagueMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      }),
    });
    const prisma = createPrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-2', email: 'member@example.com' }),
      },
    });
    const service = new SquadOwnerInvitationService(
      createInvitationRepo(),
      membershipRepo,
      createSquadRepo(),
      createSquadMembershipRepo(),
      prisma,
    );

    await expect(service.inviteOwner({
      leagueId: 'league-1',
      squadId: 'squad-1',
      actorUserId: 'user-1',
      email: 'member@example.com',
    })).rejects.toMatchObject({
      code: 'SQUAD_OWNER_INVITATION_LEAGUE_MEMBER_CONFLICT',
    });
  });

  it('immediately provisions an existing PoolMaster user from outside the league', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockImplementation(async (_leagueId: string, userId: string) => {
        if (userId === 'user-1') {
          return {
            id: 'actor-membership',
            leagueId: 'league-1',
            userId: 'user-1',
            role: LeagueRole.COMMISSIONER,
            status: LeagueMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return null;
      }),
    });
    const invitationRepo = createInvitationRepo();
    const squadMembershipRepo = createSquadMembershipRepo();
    const prisma = createPrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-9', email: 'outside@example.com' }),
      },
    });
    const service = new SquadOwnerInvitationService(
      invitationRepo,
      membershipRepo,
      createSquadRepo(),
      squadMembershipRepo,
      prisma,
    );

    const result = await service.inviteOwner({
      leagueId: 'league-1',
      squadId: 'squad-1',
      actorUserId: 'user-1',
      email: 'outside@example.com',
    });

    expect(membershipRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'league-1',
      userId: 'user-9',
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
    }));
    expect(squadMembershipRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      squadId: 'squad-1',
      userId: 'user-9',
      status: SquadMembershipStatus.ACTIVE,
    }));
    expect(invitationRepo.update).toHaveBeenCalledWith('invite-1', expect.objectContaining({
      status: SquadOwnerInvitationStatus.ACCEPTED,
      acceptedBy: 'user-9',
    }));
    expect(result.status).toBe(SquadOwnerInvitationStatus.ACCEPTED);
  });

  it('allows a root admin outsider to list invitations for any team in the league', async () => {
    const invitationRepo = createInvitationRepo({
      findByLeague: jest.fn().mockResolvedValue([
        {
          id: 'invite-1',
          leagueId: 'league-1',
          squadId: 'squad-1',
          email: 'invitee@example.com',
          inviteCode: 'invite-code',
          status: SquadOwnerInvitationStatus.PENDING,
          invitedBy: 'user-2',
          acceptedBy: null,
          acceptedAt: null,
          expiresAt: new Date('2026-04-23T00:00:00Z'),
          replacementForUserId: null,
          createdAt: new Date('2026-04-16T00:00:00Z'),
          updatedAt: new Date('2026-04-16T00:00:00Z'),
        },
      ]),
    });
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    });
    const service = new SquadOwnerInvitationService(
      invitationRepo,
      membershipRepo,
      createSquadRepo(),
      createSquadMembershipRepo(),
      createPrisma(),
    );

    const result = await service.listInvitationsForViewer('league-1', 'root-admin-1', true);

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe(SquadOwnerInvitationStatus.PENDING);
    expect(invitationRepo.findByLeague).toHaveBeenCalledWith('league-1');
  });

  it('rejects replacing yourself as an owner', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue({
        id: 'actor-membership',
        leagueId: 'league-1',
        userId: 'user-1',
        role: LeagueRole.COMMISSIONER,
        status: LeagueMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const service = new SquadOwnerInvitationService(
      createInvitationRepo(),
      membershipRepo,
      createSquadRepo(),
      createSquadMembershipRepo({
        findBySquadAndUser: jest.fn().mockResolvedValue({
          id: 'owner-membership',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'owner-membership-1',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-1',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'owner-membership-2',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-2',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      }),
      createPrisma(),
    );

    await expect(service.replaceOwner({
      leagueId: 'league-1',
      squadId: 'squad-1',
      targetUserId: 'user-1',
      actorUserId: 'user-1',
      email: 'replacement@example.com',
    })).rejects.toMatchObject({
      code: 'SQUAD_OWNER_REPLACE_SELF_FORBIDDEN',
    });
  });

  it('rejects replace-owner when the team has fewer than two active owners', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue({
        id: 'actor-membership',
        leagueId: 'league-1',
        userId: 'user-1',
        role: LeagueRole.COMMISSIONER,
        status: LeagueMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const service = new SquadOwnerInvitationService(
      createInvitationRepo(),
      membershipRepo,
      createSquadRepo(),
      createSquadMembershipRepo({
        findBySquadAndUser: jest.fn().mockResolvedValue({
          id: 'target-membership',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-2',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'target-membership',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-2',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      }),
      createPrisma(),
    );

    await expect(service.replaceOwner({
      leagueId: 'league-1',
      squadId: 'squad-1',
      targetUserId: 'user-2',
      actorUserId: 'user-1',
      email: 'replacement@example.com',
    })).rejects.toMatchObject({
      code: 'SQUAD_OWNER_REPLACE_REQUIRES_MULTIPLE_OWNERS',
    });
  });
});
