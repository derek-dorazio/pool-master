import {
  LeagueMembershipStatus,
  SquadMembershipStatus,
  SquadStatus,
  TeamIconKey,
} from '../../../packages/shared/domain';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '../../../packages/shared/db';
import { SquadOperationError, SquadService } from '../../../packages/core-api/src/modules/squads/service';

function createLeagueMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn(),
    findByUser: jest.fn(),
    findByLeagueAndUser: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  };
}

function createSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return {
    findById: jest.fn(),
    findByLeague: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  };
}

function createSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return {
    findBySquad: jest.fn(),
    findBySquadAndUser: jest.fn(),
    findByLeagueAndUser: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  };
}

describe('SquadService', () => {
  const baseMembership = {
    id: 'league-membership-1',
    leagueId: 'league-1',
    userId: 'user-1',
    role: 'MEMBER' as const,
    status: LeagueMembershipStatus.ACTIVE,
    joinedAt: new Date('2026-04-07T00:00:00Z'),
    createdAt: new Date('2026-04-07T00:00:00Z'),
    updatedAt: new Date('2026-04-07T00:00:00Z'),
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('creates a squad with a default name and creator membership', async () => {
    const squadRepo = createSquadRepo({
      create: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: "Derek Dorazio's Team",
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        status: SquadStatus.ACTIVE,
        createdAt: new Date('2026-04-07T00:00:00Z'),
        updatedAt: new Date('2026-04-07T00:00:00Z'),
      }),
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: "Derek Dorazio's Team",
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        status: SquadStatus.ACTIVE,
        createdAt: new Date('2026-04-07T00:00:00Z'),
        updatedAt: new Date('2026-04-07T00:00:00Z'),
      }),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(null),
      findBySquad: jest.fn().mockResolvedValue([
        {
          id: 'squad-membership-1',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date('2026-04-07T00:00:00Z'),
          createdAt: new Date('2026-04-07T00:00:00Z'),
          updatedAt: new Date('2026-04-07T00:00:00Z'),
        },
      ]),
      create: jest.fn().mockResolvedValue({
        id: 'squad-membership-1',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date('2026-04-07T00:00:00Z'),
        createdAt: new Date('2026-04-07T00:00:00Z'),
        updatedAt: new Date('2026-04-07T00:00:00Z'),
      }),
    });
    const leagueMembershipRepo = createLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(baseMembership),
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' });
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' }]);

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      prisma,
    );

    const result = await service.createSquad('league-1', 'user-1', {});

    expect(squadRepo.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Derek Dorazio's Team" }));
    expect(squadMembershipRepo.create).toHaveBeenCalled();
    expect(result.name).toBe("Derek Dorazio's Team");
    expect(result.iconKey).toBe(TeamIconKey.CAPTAIN_SMILE_FIELD);
    expect(result.memberCount).toBe(1);
  });

  it('rejects creating a second active squad in the same league', async () => {
    const service = new SquadService(
      createSquadRepo(),
      createSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue({
          id: 'existing-membership',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      }),
      createLeagueMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(baseMembership),
      }),
      prisma,
    );

    await expect(service.createSquad('league-1', 'user-1', {})).rejects.toThrow(
      new SquadOperationError('User already belongs to a squad in this league'),
    );
  });

  it('inactivates the squad when the last owner is removed', async () => {
    const squadRepo = createSquadRepo({
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Ace Squad',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        status: SquadStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Ace Squad',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        status: SquadStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findBySquadAndUser: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'actor-membership',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'target-membership',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      update: jest.fn().mockResolvedValue({
        id: 'target-membership',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: SquadMembershipStatus.INACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findBySquad: jest.fn().mockResolvedValue([]),
    });
    const leagueMembershipRepo = createLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(baseMembership),
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' });

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      prisma,
    );

    await service.removeOwner('league-1', 'squad-1', 'user-1', 'user-1');

    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { status: SquadStatus.INACTIVE });
  });

  it('allows a commissioner to update another team in the same league', async () => {
    const squadRepo = createSquadRepo({
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-2',
        name: 'Original Team',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        status: SquadStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-2',
        name: 'Updated Team',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        status: SquadStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findBySquad: jest.fn().mockResolvedValue([]),
    });
    const leagueMembershipRepo = createLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue({
        ...baseMembership,
        role: 'COMMISSIONER',
      }),
    });

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      prisma,
    );

    await service.updateSquad('league-1', 'squad-1', 'user-1', { name: 'Updated Team' });

    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { name: 'Updated Team' });
  });

  it('inactivates a team, removes active owners from the league, and inactivates users with no other leagues', async () => {
    let archivedTeamReads = 0;
    const findByIdMock = jest.fn().mockImplementation(async () => {
      archivedTeamReads += 1;
      return {
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Shared Team',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        status: archivedTeamReads <= 2 ? SquadStatus.ACTIVE : SquadStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
    const squadRepo = createSquadRepo({
      findById: findByIdMock,
      update: jest.fn().mockImplementation(async (id, updates) => ({
        id,
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: updates.name ?? 'Shared Team',
        iconKey: updates.iconKey ?? TeamIconKey.CAPTAIN_SMILE_FIELD,
        status: updates.status ?? SquadStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      create: jest.fn(),
    });
    const activeTeamMemberships = [
      {
        id: 'membership-1',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'membership-2',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'user-2',
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const squadMembershipRepo = createSquadMembershipRepo({
      findByLeagueAndUser: jest
        .fn()
        .mockResolvedValueOnce(activeTeamMemberships[0])
        .mockResolvedValueOnce(activeTeamMemberships[1]),
      findBySquad: jest
        .fn()
        .mockResolvedValueOnce(activeTeamMemberships)
        .mockResolvedValueOnce([activeTeamMemberships[1]])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      update: jest.fn().mockImplementation(async (id, updates) => ({
        id,
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: id === 'membership-1' ? 'user-1' : 'user-2',
        status: updates.status ?? SquadMembershipStatus.ACTIVE,
        joinedAt: updates.joinedAt ?? new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      create: jest.fn(),
    });
    const leagueMembershipRepo = createLeagueMembershipRepo({
      findByLeagueAndUser: jest
        .fn()
        .mockResolvedValueOnce({
          ...baseMembership,
          role: 'COMMISSIONER',
        })
        .mockResolvedValueOnce({
          ...baseMembership,
          userId: 'user-1',
          role: 'MEMBER',
        })
        .mockResolvedValueOnce({
          ...baseMembership,
          userId: 'user-2',
          role: 'MEMBER',
        }),
      findByUser: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    });
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-1', isActive: true, isRootAdmin: false })
      .mockResolvedValueOnce({ id: 'user-2', isActive: true, isRootAdmin: false });
    prisma.user.findMany.mockResolvedValue([]);
    prisma.$transaction = jest.fn().mockImplementation(async (callback) =>
      callback({
        user: { update: jest.fn().mockResolvedValue(undefined) },
        refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      }));

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      prisma,
    );

    await service.inactivateSquad('league-1', 'squad-1', 'user-1');

    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { status: SquadStatus.INACTIVE });
    expect(squadMembershipRepo.update).toHaveBeenCalledWith('membership-1', { status: SquadMembershipStatus.INACTIVE });
    expect(squadMembershipRepo.update).toHaveBeenCalledWith('membership-2', { status: SquadMembershipStatus.INACTIVE });
    expect(leagueMembershipRepo.update).toHaveBeenCalledWith(baseMembership.id, {
      status: LeagueMembershipStatus.INACTIVE,
    });
    expect(squadRepo.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
