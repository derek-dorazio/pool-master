import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
  UserRepository,
} from '@poolmaster/shared/db';
import {
  LeagueMembershipStatus,
  LeagueRole,
  SquadMembershipStatus,
  TeamIconKey,
} from '@poolmaster/shared/domain';
import { inactivateLeagueMemberUnit } from '../../../packages/core-api/src/modules/leagues/member-lifecycle';
import { deactivateSquadMembershipForLeagueMember } from '../../../packages/core-api/src/modules/squads/owner-membership';
import { ensureDefaultSquadForLeagueMember } from '../../../packages/core-api/src/modules/squads/default-squad';
import { buildMembership, buildUser } from '../../factories';
import {
  fakeLeagueMembershipRepo,
  fakeSquadMembershipRepo,
  fakeSquadRepo,
  fakeUserRepo,
} from '../../support/repo-fakes';

function createMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return fakeLeagueMembershipRepo({
    ...overrides,
  });
}

function createSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return fakeSquadRepo({
    ...overrides,
  });
}

function createSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return fakeSquadMembershipRepo({
    ...overrides,
  });
}

function createUsers(): UserRepository {
  return fakeUserRepo({
    findById: jest.fn().mockResolvedValue(buildUser({ id: 'user-1', firstName: 'Casey', lastName: 'Jones' })),
  });
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
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(undefined),
    });
    const squad = await ensureDefaultSquadForLeagueMember({
      leagueId: 'league-1',
      userId: 'user-1',
      squadRepo,
      squadMembershipRepo,
      users: createUsers(),
    });

    expect(squadRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'league-1',
      createdBy: 'user-1',
      isActive: true,
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
          isActive: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'squad-1',
          leagueId: 'league-1',
          createdBy: 'user-1',
          name: "Casey Jones's Team",
          iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          isActive: true,
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
      users: createUsers(),
    });

    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { isActive: true });
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
    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { isActive: false });
  });

  /**
   * #218 — these two cases replace "deactivates the user account when their final active league
   * membership is removed" and "preserves the user account when other active league memberships
   * remain". Both asserted the cascade that is now gone: the unit no longer looks at whether this
   * was the user's last league, and no longer writes `user.isActive` or revokes refresh tokens.
   */
  it('ends the league and squad membership and leaves the user account alone', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership({
        id: 'membership-1',
        leagueId: 'league-1',
        userId: 'user-1',
        role: LeagueRole.MEMBER,
        status: LeagueMembershipStatus.ACTIVE,
      })),
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

    await inactivateLeagueMemberUnit({
      leagueId: 'league-1',
      userId: 'user-1',
      membershipRepo,
      squadRepo,
      squadMembershipRepo,
    });

    expect(membershipRepo.update).toHaveBeenCalledWith(
      'membership-1',
      expect.objectContaining({ status: LeagueMembershipStatus.INACTIVE }),
    );
    expect(squadMembershipRepo.update).toHaveBeenCalledWith(
      'squad-membership-1',
      expect.objectContaining({ status: SquadMembershipStatus.INACTIVE }),
    );
    // The account guarantee is structural now, not conditional: the unit takes no Prisma client,
    // so it has no way to write `user.isActive` or revoke a token. That is the point — a
    // commissioner ending a membership cannot lock someone out of the product.
  });

  it('does not ask whether this was the user\'s last league, because it no longer matters', async () => {
    const membershipRepo = createMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership({
        id: 'membership-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: LeagueMembershipStatus.ACTIVE,
      })),
    });

    await inactivateLeagueMemberUnit({
      leagueId: 'league-1',
      userId: 'user-1',
      membershipRepo,
    });

    // `findByUser` was the last-league check that gated account deactivation. Asserting it is
    // never called is how this test proves the branch is gone rather than merely unreached.
    expect(membershipRepo.findByUser).not.toHaveBeenCalled();
  });
});
