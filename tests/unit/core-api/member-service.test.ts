import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
} from '@poolmaster/shared/domain';
import {
  MemberNotFoundError,
  MemberOperationError,
  MemberService,
} from '../../../packages/core-api/src/modules/leagues/member-service';
import { buildMembership } from '../../factories';

function createMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([]),
    findByUser: jest.fn().mockResolvedValue([]),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      ...buildMembership({ id }),
      ...updates,
    })),
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
    findBySquad: jest.fn().mockResolvedValue([]),
    findBySquadAndUser: jest.fn(),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
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
        isActive: true,
        isRootAdmin: false,
      }),
    },
    $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
    __tx: tx,
  };
}

describe('MemberService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('changes a member role when the membership is active', async () => {
    const membership = buildMembership({
      leagueId: 'league-1',
      userId: 'user-2',
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
    });
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
    });
    const service = new MemberService(
      membershipRepo,
      createPrisma() as any,
      createSquadRepo(),
      createSquadMembershipRepo(),
    );

    const updatedMembership = await service.changeRole({
      leagueId: 'league-1',
      targetUserId: 'user-2',
      newRole: LeagueRole.COMMISSIONER,
    });

    expect(membershipRepo.update).toHaveBeenCalledWith(
      membership.id,
      expect.objectContaining({ role: LeagueRole.COMMISSIONER }),
    );
    expect(updatedMembership.role).toBe(LeagueRole.COMMISSIONER);
  });

  it('rejects changing the role for a missing member', async () => {
    const service = new MemberService(
      createMembershipRepo(),
      createPrisma() as any,
      createSquadRepo(),
      createSquadMembershipRepo(),
    );

    await expect(service.changeRole({
      leagueId: 'league-1',
      targetUserId: 'missing-user',
      newRole: LeagueRole.MEMBER,
    })).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it('rejects changing the role for an inactive member', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership({
        leagueId: 'league-1',
        userId: 'user-2',
        status: LeagueMembershipStatus.INACTIVE,
      })),
    });
    const service = new MemberService(
      membershipRepo,
      createPrisma() as any,
      createSquadRepo(),
      createSquadMembershipRepo(),
    );

    await expect(service.changeRole({
      leagueId: 'league-1',
      targetUserId: 'user-2',
      newRole: LeagueRole.MEMBER,
    })).rejects.toMatchObject({
      code: 'LEAGUE_MEMBER_INACTIVE',
    });
  });

  it('rejects demoting the last active commissioner', async () => {
    const commissioner = buildMembership({
      leagueId: 'league-1',
      userId: 'user-1',
      role: LeagueRole.COMMISSIONER,
      status: LeagueMembershipStatus.ACTIVE,
    });
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(commissioner),
      findByLeague: jest.fn().mockResolvedValue([commissioner]),
    });
    const service = new MemberService(
      membershipRepo,
      createPrisma() as any,
      createSquadRepo(),
      createSquadMembershipRepo(),
    );

    await expect(service.changeRole({
      leagueId: 'league-1',
      targetUserId: 'user-1',
      newRole: LeagueRole.MEMBER,
    })).rejects.toMatchObject({
      code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED',
    });
  });

  it('removes an active member and deactivates the user when it was their last league', async () => {
    const membership = buildMembership({
      id: 'membership-1',
      leagueId: 'league-1',
      userId: 'user-1',
      role: LeagueRole.MEMBER,
      status: LeagueMembershipStatus.ACTIVE,
    });
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      findByUser: jest.fn().mockResolvedValue([]),
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
    const squadRepo = createSquadRepo({
      update: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Solo Team',
        iconKey: 'CAPTAIN_SMILE_FIELD',
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const prisma = createPrisma();
    const service = new MemberService(
      membershipRepo,
      prisma as any,
      squadRepo,
      squadMembershipRepo,
    );

    await service.removeMember('league-1', 'user-1');

    expect(membershipRepo.update).toHaveBeenCalledWith(
      membership.id,
      expect.objectContaining({ status: LeagueMembershipStatus.INACTIVE }),
    );
    expect(squadMembershipRepo.update).toHaveBeenCalledWith(
      'squad-membership-1',
      expect.objectContaining({ status: SquadMembershipStatus.INACTIVE }),
    );
    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { isActive: false });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects removing the last active commissioner', async () => {
    const commissioner = buildMembership({
      leagueId: 'league-1',
      userId: 'user-1',
      role: LeagueRole.COMMISSIONER,
      status: LeagueMembershipStatus.ACTIVE,
    });
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(commissioner),
      findByLeague: jest.fn().mockResolvedValue([commissioner]),
    });
    const service = new MemberService(
      membershipRepo,
      createPrisma() as any,
      createSquadRepo(),
      createSquadMembershipRepo(),
    );

    await expect(service.removeMember('league-1', 'user-1')).rejects.toBeInstanceOf(MemberOperationError);
  });
});
