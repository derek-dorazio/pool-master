import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  SquadStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import { inactivateLeagueMemberUnit } from '../../../packages/core-api/src/modules/leagues/member-lifecycle';
import { deactivateSquadMembershipForLeagueMember } from '../../../packages/core-api/src/modules/squads/owner-membership';
import { ensureDefaultSquadForLeagueMember } from '../../../packages/core-api/src/modules/squads/default-squad';
import { buildMembership } from '../../factories';

function createMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([]),
    findByUser: jest.fn().mockResolvedValue([]),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn(),
    ...overrides,
  };
}

function createSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByLeague: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
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
    create: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn(),
    ...overrides,
  };
}

function createPrisma() {
  const tx = {
    user: { update: jest.fn().mockResolvedValue(undefined) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        firstName: 'Casey',
        lastName: 'Jones',
        isActive: true,
        isRootAdmin: false,
      }),
    },
    $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
    __tx: tx,
  };
}

describe('league member lifecycle helpers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('creates a default squad and ownership membership for a new league member', async () => {
    const squadRepo = createSquadRepo({
      create: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: "Casey Jones's Team",
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        status: SquadStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
    });
    const prisma = createPrisma();

    const squad = await ensureDefaultSquadForLeagueMember({
      leagueId: 'league-1',
      userId: 'user-1',
      squadRepo,
      squadMembershipRepo,
      prisma: prisma as any,
    });

    expect(squadRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'league-1',
      createdBy: 'user-1',
      status: SquadStatus.ACTIVE,
    }));
    expect(squadMembershipRepo.create).toHaveBeenCalled();
    expect(squad.id).toBe('squad-1');
  });

  it('reactivates an existing squad membership and squad when history exists', async () => {
    const squadRepo = createSquadRepo({
      findById: jest.fn()
        .mockResolvedValueOnce({
          id: 'squad-1',
          leagueId: 'league-1',
          createdBy: 'user-1',
          name: "Casey Jones's Team",
          iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          status: SquadStatus.INACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'squad-1',
          leagueId: 'league-1',
          createdBy: 'user-1',
          name: "Casey Jones's Team",
          iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          status: SquadStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      update: jest.fn().mockResolvedValue(undefined),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue({
        id: 'squad-membership-1',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: SquadMembershipStatus.INACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue(undefined),
    });

    const squad = await ensureDefaultSquadForLeagueMember({
      leagueId: 'league-1',
      userId: 'user-1',
      squadRepo,
      squadMembershipRepo,
      prisma: createPrisma() as any,
    });

    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { status: SquadStatus.ACTIVE });
    expect(squadMembershipRepo.update).toHaveBeenCalledWith(
      'squad-membership-1',
      expect.objectContaining({ status: SquadMembershipStatus.ACTIVE }),
    );
    expect(squad.id).toBe('squad-1');
  });

  it('deactivates a squad membership and inactivates the squad when the last owner leaves', async () => {
    const squadRepo = createSquadRepo({
      update: jest.fn().mockResolvedValue(undefined),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue({
        id: 'squad-membership-1',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findBySquad: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    });

    await deactivateSquadMembershipForLeagueMember({
      leagueId: 'league-1',
      userId: 'user-1',
      squadRepo,
      squadMembershipRepo,
    });

    expect(squadMembershipRepo.update).toHaveBeenCalledWith(
      'squad-membership-1',
      expect.objectContaining({ status: SquadMembershipStatus.INACTIVE }),
    );
    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { status: SquadStatus.INACTIVE });
  });

  it('deactivates the user account when their final active league membership is removed', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership({
        id: 'membership-1',
        leagueId: 'league-1',
        userId: 'user-1',
        role: LeagueRole.MEMBER,
        status: LeagueMembershipStatus.ACTIVE,
      })),
      findByUser: jest.fn().mockResolvedValue([]),
    });
    const squadRepo = createSquadRepo({
      update: jest.fn().mockResolvedValue(undefined),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue({
        id: 'squad-membership-1',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findBySquad: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    });
    const prisma = createPrisma();

    await inactivateLeagueMemberUnit({
      leagueId: 'league-1',
      userId: 'user-1',
      membershipRepo,
      prisma: prisma as any,
      squadRepo,
      squadMembershipRepo,
    });

    expect(membershipRepo.update).toHaveBeenCalledWith(
      'membership-1',
      expect.objectContaining({ status: LeagueMembershipStatus.INACTIVE }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('preserves the user account when other active league memberships remain', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership({
        id: 'membership-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: LeagueMembershipStatus.ACTIVE,
      })),
      findByUser: jest.fn().mockResolvedValue([buildMembership({
        leagueId: 'league-2',
        userId: 'user-1',
        status: LeagueMembershipStatus.ACTIVE,
      })]),
    });
    const prisma = createPrisma();

    await inactivateLeagueMemberUnit({
      leagueId: 'league-1',
      userId: 'user-1',
      membershipRepo,
      prisma: prisma as any,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
