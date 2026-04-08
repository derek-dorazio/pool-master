import { SquadMembershipStatus, SquadStatus } from '../../../packages/shared/domain';
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
    role: 'MANAGER' as const,
    permissions: [],
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
        name: "Derek's Squad",
        iconUrl: undefined,
        status: SquadStatus.ACTIVE,
        createdAt: new Date('2026-04-07T00:00:00Z'),
        updatedAt: new Date('2026-04-07T00:00:00Z'),
      }),
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: "Derek's Squad",
        iconUrl: undefined,
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
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', displayName: 'Derek' });
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', displayName: 'Derek' }]);

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      prisma,
    );

    const result = await service.createSquad('league-1', 'user-1', {});

    expect(squadRepo.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Derek's Squad" }));
    expect(squadMembershipRepo.create).toHaveBeenCalled();
    expect(result.name).toBe("Derek's Squad");
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

  it('inactivates the squad when the last co-manager is removed', async () => {
    const squadRepo = createSquadRepo({
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Ace Squad',
        iconUrl: undefined,
        status: SquadStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Ace Squad',
        iconUrl: undefined,
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
    const leagueMembershipRepo = createLeagueMembershipRepo();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', displayName: 'Derek' });

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      prisma,
    );

    await service.removeCoManager('league-1', 'squad-1', 'user-1', 'user-1');

    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { status: SquadStatus.INACTIVE });
  });
});
