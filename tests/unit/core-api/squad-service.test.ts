import {
  LeagueMembershipStatus,
  SquadMembershipStatus,
  TeamIconKey,
} from '../../../packages/shared/domain';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '../../../packages/shared/db';
import { SquadOperationError, SquadService } from '../../../packages/core-api/src/modules/squads/service';
import {
  fakeLeagueMembershipRepo,
  fakeSquadMembershipRepo,
  fakeSquadRepo,
  fakeUserRepo,
} from '../../support/repo-fakes';
import type { User } from '../../../packages/shared/domain';

/**
 * #202 step 3.4 — members come off `UserRepository` now, not a raw `prisma.user` select of
 * three columns, because the squad edge embeds the canonical `UserDto`.
 */
function buildUser(overrides: Partial<User> & { id: string }): User {
  return {
    email: `${overrides.id}@example.com`,
    username: overrides.id,
    firstName: 'Member',
    lastName: 'User',
    isActive: true,
    isRootAdmin: false,
    createdAt: new Date('2026-04-07T00:00:00Z'),
    updatedAt: new Date('2026-04-07T00:00:00Z'),
    ...overrides,
  };
}

function createLeagueMembershipRepo(
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

  // What is left on prisma: nothing this suite drives. The service still holds it for the
  // squad-delete transaction, which the delete tests exercise through their own mock.
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;

  const userRepo = fakeUserRepo({ findById: jest.fn(), findByLeague: jest.fn() });
  const userFindById = userRepo.findById as jest.Mock;
  const userFindByLeague = userRepo.findByLeague as jest.Mock;

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
        isActive: true,
        createdAt: new Date('2026-04-07T00:00:00Z'),
        updatedAt: new Date('2026-04-07T00:00:00Z'),
      }),
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: "Derek Dorazio's Team",
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        isActive: true,
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
    userFindById.mockResolvedValue(buildUser({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' }));
    userFindByLeague.mockResolvedValue([buildUser({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' })]);

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      userRepo,
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
      userRepo,
      prisma,
    );

    await expect(service.createSquad('league-1', 'user-1', {})).rejects.toThrow(
      new SquadOperationError('User already belongs to a squad in this league'),
    );
  });

  it('lets a root admin who is not a league member list its squads, with no viewer fields on them', async () => {
    const squadRepo = createSquadRepo({
      findByLeague: jest.fn().mockResolvedValue([
        {
          id: 'squad-1',
          leagueId: 'league-1',
          createdBy: 'user-2',
          name: 'Ace Squad',
          iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
          isActive: true,
          createdAt: new Date('2026-04-07T00:00:00Z'),
          updatedAt: new Date('2026-04-07T00:00:00Z'),
        },
      ]),
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-2',
        name: 'Ace Squad',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        isActive: true,
        createdAt: new Date('2026-04-07T00:00:00Z'),
        updatedAt: new Date('2026-04-07T00:00:00Z'),
      }),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findBySquad: jest.fn().mockResolvedValue([
        {
          id: 'membership-2',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-2',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date('2026-04-07T00:00:00Z'),
          createdAt: new Date('2026-04-07T00:00:00Z'),
          updatedAt: new Date('2026-04-07T00:00:00Z'),
        },
      ]),
    });
    const leagueMembershipRepo = createLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    });
    userFindByLeague.mockResolvedValue([buildUser({ id: 'user-2', firstName: 'Fran', lastName: 'Lane' })]);

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      userRepo,
      prisma,
    );

    // findByLeagueAndUser resolves null, so this caller holds no membership in the league.
    // A1 lets a root admin read it anyway.
    const result = await service.listSquads('league-1', 'root-admin-1', true);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('squad-1');
    // #202 step 3.4 — asserted as an absence, because that is the rule. Under A8 the squad
    // is a value of the entity: `teamRelationship` and `isRootAdmin` used to make it a
    // function of who asked, and this caller is precisely the one that had to invent values
    // for them.
    expect(result[0]).not.toHaveProperty('teamRelationship');
    expect(result[0]).not.toHaveProperty('isRootAdmin');
  });

  it('rejects removing the last active owner and requires team inactivation instead', async () => {
    const squadRepo = createSquadRepo({
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Ace Squad',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        isActive: true,
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
      update: jest.fn(),
      findBySquad: jest.fn().mockResolvedValue([
        {
          id: 'target-membership',
          squadId: 'squad-1',
          leagueId: 'league-1',
          userId: 'user-1',
          status: SquadMembershipStatus.ACTIVE,
          joinedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    });
    const leagueMembershipRepo = createLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue(baseMembership),
    });
    userFindById.mockResolvedValue(buildUser({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' }));

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      userRepo,
      prisma,
    );

    await expect(service.removeOwner('league-1', 'squad-1', 'user-1', 'user-1')).rejects.toThrow(
      new SquadOperationError(
        'This team only has one active owner. Inactivate the team instead.',
        'SQUAD_OWNER_REMOVE_REQUIRES_MULTIPLE_OWNERS',
      ),
    );

    expect(squadMembershipRepo.update).not.toHaveBeenCalled();
    expect(squadRepo.update).not.toHaveBeenCalled();
  });

  /**
   * #218 — removing a squad co-owner also ends their LEAGUE membership.
   *
   * Before this, the squad membership went INACTIVE and the league membership stayed ACTIVE,
   * leaving a league member with no squad. Since every member has exactly one squad, they
   * disappeared from every surface that lists people in the league while keeping league access.
   */
  describe('removeOwner ends the league membership too (#218)', () => {
    function squadMemberships(userIds: string[]) {
      return userIds.map((userId, index) => ({
        id: `squad-membership-${index + 1}`,
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId,
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    }

    function primeRepos(options: { targetRole?: 'MEMBER' | 'COMMISSIONER'; leagueMemberships?: unknown[] } = {}) {
      const owners = squadMemberships(['commissioner-1', 'co-owner-1']);
      const target = owners[1];

      const squadRepo = createSquadRepo({
        findById: jest.fn().mockResolvedValue({
          id: 'squad-1',
          leagueId: 'league-1',
          createdBy: 'commissioner-1',
          name: 'Shared Team',
          iconKey: 'CAPTAIN_SMILE_FIELD',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      });
      const squadMembershipRepo = createSquadMembershipRepo({
        findBySquadAndUser: jest.fn().mockResolvedValue(target),
        findByLeagueAndUser: jest.fn().mockResolvedValue(target),
        findBySquad: jest.fn().mockResolvedValue(owners),
        update: jest.fn().mockResolvedValue({
          ...target,
          status: SquadMembershipStatus.INACTIVE,
        }),
      });

      const targetLeagueMembership = {
        ...baseMembership,
        id: 'league-membership-co-owner',
        userId: 'co-owner-1',
        role: options.targetRole ?? ('MEMBER' as const),
      };
      const commissionerMembership = {
        ...baseMembership,
        id: 'league-membership-commissioner',
        userId: 'commissioner-1',
        role: 'COMMISSIONER' as const,
      };
      const leagueMembershipRepo = createLeagueMembershipRepo({
        findByLeagueAndUser: jest.fn().mockImplementation(async (_leagueId, userId) =>
          userId === 'co-owner-1' ? targetLeagueMembership : commissionerMembership),
        findByLeague: jest.fn().mockResolvedValue(
          options.leagueMemberships ?? [commissionerMembership, targetLeagueMembership],
        ),
        update: jest.fn().mockResolvedValue(targetLeagueMembership),
      });

      userFindById.mockResolvedValue(
        buildUser({ id: 'co-owner-1', firstName: 'Fran', lastName: 'Lane' }),
      );

      return {
        squadRepo,
        squadMembershipRepo,
        leagueMembershipRepo,
        service: new SquadService(
          squadRepo,
          squadMembershipRepo,
          leagueMembershipRepo,
          userRepo,
          prisma,
        ),
      };
    }

    it('ends both the squad membership and the league membership', async () => {
      const { service, squadMembershipRepo, leagueMembershipRepo } = primeRepos();

      await service.removeOwner('league-1', 'squad-1', 'commissioner-1', 'co-owner-1');

      expect(squadMembershipRepo.update).toHaveBeenCalledWith(
        'squad-membership-2',
        expect.objectContaining({ status: SquadMembershipStatus.INACTIVE }),
      );
      expect(leagueMembershipRepo.update).toHaveBeenCalledWith(
        'league-membership-co-owner',
        expect.objectContaining({ status: LeagueMembershipStatus.INACTIVE }),
      );
    });

    it('leaves the removed owner\'s user account active so they can be re-invited', async () => {
      const { service } = primeRepos();

      await service.removeOwner('league-1', 'squad-1', 'commissioner-1', 'co-owner-1');

      // The whole point of routing through the shared unit after #218 stripped its account
      // cascade: a commissioner removing someone from a team cannot stop them signing in, so the
      // re-invite flow the repo owner described actually works.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('refuses to remove a co-owner who is the league\'s last active commissioner', async () => {
      const commissionerOnly = {
        ...baseMembership,
        id: 'league-membership-co-owner',
        userId: 'co-owner-1',
        role: 'COMMISSIONER' as const,
      };
      const { service, squadMembershipRepo, leagueMembershipRepo } = primeRepos({
        targetRole: 'COMMISSIONER',
        leagueMemberships: [commissionerOnly],
      });

      // A co-owner can be the league's last commissioner while sitting on somebody else's squad.
      // Ending their league membership would leave the league with nobody who can administer it,
      // which is why the rule had to be shared rather than left in MemberService.
      await expect(
        service.removeOwner('league-1', 'squad-1', 'co-owner-1', 'co-owner-1'),
      ).rejects.toMatchObject({ code: 'LEAGUE_LAST_COMMISSIONER_REQUIRED' });

      expect(squadMembershipRepo.update).not.toHaveBeenCalled();
      expect(leagueMembershipRepo.update).not.toHaveBeenCalled();
    });
  });

  it('allows a commissioner to update another team in the same league', async () => {
    const squadRepo = createSquadRepo({
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-2',
        name: 'Original Team',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-2',
        name: 'Updated Team',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        isActive: true,
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
      userRepo,
      prisma,
    );

    await service.updateSquad('league-1', 'squad-1', 'user-1', { name: 'Updated Team' });

    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { name: 'Updated Team' });
  });

  // #202 — squad names are unique within a league (@@unique([leagueId, name])). These four
  // cases cover the split: a name the user typed is rejected on collision, a default name
  // they did not choose is disambiguated instead of blocking them.
  describe('squad name uniqueness within a league', () => {
    function buildSquadRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Existing Team',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        isActive: true,
        createdAt: new Date('2026-04-07T00:00:00Z'),
        updatedAt: new Date('2026-04-07T00:00:00Z'),
        ...overrides,
      };
    }

    it('rejects a user-chosen name another squad in the league already holds', async () => {
      const squadRepo = createSquadRepo({
        findByLeagueAndName: jest.fn().mockResolvedValue(buildSquadRow({ id: 'squad-other' })),
      });
      const squadMembershipRepo = createSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(null),
      });
      const leagueMembershipRepo = createLeagueMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(baseMembership),
      });
      userFindById.mockResolvedValue(buildUser({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' }));

      const service = new SquadService(squadRepo, squadMembershipRepo, leagueMembershipRepo, userRepo, prisma);

      await expect(
        service.createSquad('league-1', 'user-1', { name: 'Existing Team' }),
      ).rejects.toMatchObject({ code: 'SQUAD_NAME_TAKEN' });
      expect(squadRepo.create).not.toHaveBeenCalled();
    });

    it('disambiguates a colliding DEFAULT name rather than blocking the create', async () => {
      // Two members of one league who share a name would otherwise both want
      // "Derek Dorazio's Team". The second must still get a squad.
      const findByLeagueAndName = jest.fn()
        .mockResolvedValueOnce(buildSquadRow({ id: 'squad-other', name: "Derek Dorazio's Team" }))
        .mockResolvedValueOnce(null);
      const squadRepo = createSquadRepo({
        findByLeagueAndName,
        create: jest.fn().mockResolvedValue(buildSquadRow({ name: "Derek Dorazio's Team 2" })),
        findById: jest.fn().mockResolvedValue(buildSquadRow({ name: "Derek Dorazio's Team 2" })),
      });
      const squadMembershipRepo = createSquadMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(null),
        findBySquad: jest.fn().mockResolvedValue([]),
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
      userFindById.mockResolvedValue(buildUser({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' }));
      userFindByLeague.mockResolvedValue([]);

      const service = new SquadService(squadRepo, squadMembershipRepo, leagueMembershipRepo, userRepo, prisma);

      await service.createSquad('league-1', 'user-1', {});

      expect(findByLeagueAndName).toHaveBeenNthCalledWith(1, 'league-1', "Derek Dorazio's Team");
      expect(findByLeagueAndName).toHaveBeenNthCalledWith(2, 'league-1', "Derek Dorazio's Team 2");
      expect(squadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Derek Dorazio's Team 2" }),
      );
    });

    it('rejects renaming a squad onto a name another squad holds', async () => {
      const squadRepo = createSquadRepo({
        findById: jest.fn().mockResolvedValue(buildSquadRow({ name: 'Original Team' })),
        findByLeagueAndName: jest.fn().mockResolvedValue(buildSquadRow({ id: 'squad-other' })),
      });
      const squadMembershipRepo = createSquadMembershipRepo({
        findBySquad: jest.fn().mockResolvedValue([]),
      });
      const leagueMembershipRepo = createLeagueMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue({ ...baseMembership, role: 'COMMISSIONER' }),
      });

      const service = new SquadService(squadRepo, squadMembershipRepo, leagueMembershipRepo, userRepo, prisma);

      await expect(
        service.updateSquad('league-1', 'squad-1', 'user-1', { name: 'Existing Team' }),
      ).rejects.toMatchObject({ code: 'SQUAD_NAME_TAKEN' });
      expect(squadRepo.update).not.toHaveBeenCalled();
    });

    it('allows a squad to keep its own name on update', async () => {
      // The uniqueness check must exclude the squad being renamed, or a no-op rename
      // would collide with itself.
      const squadRepo = createSquadRepo({
        findById: jest.fn().mockResolvedValue(buildSquadRow()),
        findByLeagueAndName: jest.fn().mockResolvedValue(buildSquadRow({ id: 'squad-1' })),
        update: jest.fn().mockResolvedValue(buildSquadRow()),
      });
      const squadMembershipRepo = createSquadMembershipRepo({
        findBySquad: jest.fn().mockResolvedValue([]),
      });
      const leagueMembershipRepo = createLeagueMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue({ ...baseMembership, role: 'COMMISSIONER' }),
      });

      const service = new SquadService(squadRepo, squadMembershipRepo, leagueMembershipRepo, userRepo, prisma);

      await service.updateSquad('league-1', 'squad-1', 'user-1', { name: 'Existing Team' });

      expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { name: 'Existing Team' });
    });
  });

  /**
   * #219 — inactivating a team is commissioner-only.
   *
   * It used to be `requireSquadManager`, which admits the squad's own owners. #218 made that
   * consequential: inactivating a squad ends its owners' league memberships, so a sole owner could
   * remove themselves from the league via a button on their own team page.
   */
  it('refuses to let a plain team owner inactivate their own team', async () => {
    const squadRepo = createSquadRepo({
      findById: jest.fn().mockResolvedValue({
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Owner Team',
        iconKey: 'CAPTAIN_SMILE_FIELD',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn(),
    });
    const squadMembershipRepo = createSquadMembershipRepo({
      findBySquadAndUser: jest.fn().mockResolvedValue({
        id: 'squad-membership-1',
        squadId: 'squad-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: SquadMembershipStatus.ACTIVE,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn(),
    });
    // An active owner of this squad, and an ordinary MEMBER of the league.
    const leagueMembershipRepo = createLeagueMembershipRepo({
      findByLeagueAndUser: jest.fn().mockResolvedValue({ ...baseMembership, role: 'MEMBER' }),
      update: jest.fn(),
    });
    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      userRepo,
      prisma,
    );

    await expect(service.inactivateSquad('league-1', 'squad-1', 'user-1')).rejects.toMatchObject({
      code: 'LEAGUE_PERMISSION_DENIED',
    });

    // Nothing written: not the squad, not the squad membership, and not the league membership.
    expect(squadRepo.update).not.toHaveBeenCalled();
    expect(squadMembershipRepo.update).not.toHaveBeenCalled();
    expect(leagueMembershipRepo.update).not.toHaveBeenCalled();
  });

  // #218 — was "…and inactivates users with no other leagues". Inactivating a squad ends its
  // owners' league memberships, but no longer their accounts.
  it('inactivates a team and removes its active owners from the league, leaving their accounts active', async () => {
    let archivedTeamReads = 0;
    const findByIdMock = jest.fn().mockImplementation(async () => {
      archivedTeamReads += 1;
      return {
        id: 'squad-1',
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Shared Team',
        iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
        isActive: archivedTeamReads <= 2,
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
        isActive: updates.isActive ?? true,
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
    userFindByLeague.mockResolvedValue([]);

    const service = new SquadService(
      squadRepo,
      squadMembershipRepo,
      leagueMembershipRepo,
      userRepo,
      prisma,
    );

    await service.inactivateSquad('league-1', 'squad-1', 'user-1');

    expect(squadRepo.update).toHaveBeenCalledWith('squad-1', { isActive: false });
    expect(squadMembershipRepo.update).toHaveBeenCalledWith('membership-1', { status: SquadMembershipStatus.INACTIVE });
    expect(squadMembershipRepo.update).toHaveBeenCalledWith('membership-2', { status: SquadMembershipStatus.INACTIVE });
    expect(leagueMembershipRepo.update).toHaveBeenCalledWith(baseMembership.id, {
      status: LeagueMembershipStatus.INACTIVE,
    });
    expect(squadRepo.create).not.toHaveBeenCalled();
    // No account writes: two owners lose their league membership and both keep a usable login.
    // The old cascade read the user row to decide whether to deactivate it; nothing reads it now,
    // and this suite's prisma fixture has no `$transaction` at all, so the absence is structural.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
