import { LeagueService } from '../../../packages/core-api/src/modules/leagues/service';
import type {
  LeagueMembershipRepository,
  LeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import { JoinPolicy, LeagueIconKey, LeagueRole, SquadMembershipStatus, TeamIconKey } from '@poolmaster/shared/domain';
import { buildLeague, buildMembership } from '../../factories';
import {
  fakeLeagueMembershipRepo,
  fakeLeagueRepo,
  fakeSquadMembershipRepo,
  fakeSquadRepo,
} from '../../support/repo-fakes';

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return fakeLeagueRepo({
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-league-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      ...buildLeague({ id }),
      ...updates,
    })),
    ...overrides,
  });
}

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return fakeLeagueMembershipRepo({
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-membership-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockResolvedValue(buildMembership()),
    ...overrides,
  });
}

function createMockSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return fakeSquadRepo({
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-squad-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      leagueId: 'new-league-id',
      createdBy: 'user-1',
      name: "User One's Team",
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...updates,
    })),
    ...overrides,
  });
}

function createMockSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return fakeSquadMembershipRepo({
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-squad-membership-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      squadId: 'new-squad-id',
      leagueId: 'new-league-id',
      userId: 'user-1',
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...updates,
    })),
    ...overrides,
  });
}

function createMockProvisioningPrisma() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        firstName: 'User',
        lastName: 'One',
      }),
    },
  };
}

function createMockLifecyclePrisma() {
  const tx = {
    draftPickHistory: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestEntryPick: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    draftSession: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    participantContestScoringRule: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestPrizeDefinition: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestConfiguration: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contest: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    commissionerActionItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    leagueInvitation: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    squadMembership: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    leagueMembership: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    squad: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    league: { delete: jest.fn().mockResolvedValue(undefined) },
  };

  const prisma = {
    $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
  };

  return { prisma, tx };
}

describe('LeagueService', () => {
  describe('createLeague', () => {
    it('creates a league and a COMMISSIONER membership', async () => {
      const leagueRepo = createMockLeagueRepo({
        findByCode: jest.fn().mockResolvedValue(null),
      });
      const membershipRepo = createMockMembershipRepo();
      const squadRepo = createMockSquadRepo();
      const squadMembershipRepo = createMockSquadMembershipRepo();
      const service = new LeagueService(
        leagueRepo,
        membershipRepo,
        squadRepo,
        squadMembershipRepo,
        createMockProvisioningPrisma() as any,
      );
      const result = await service.createLeague({
        createdBy: 'user-1',
        name: 'My League',
        leagueCode: 'MYLEAGUE',
      });
      expect(leagueRepo.create).toHaveBeenCalledTimes(1);
      expect(membershipRepo.create).toHaveBeenCalledTimes(1);
      const membershipInput = (membershipRepo.create as jest.Mock).mock.calls[0][0];
      expect(membershipInput.role).toBe(LeagueRole.COMMISSIONER);
      expect(membershipInput.userId).toBe('user-1');
      expect(squadRepo.create).toHaveBeenCalledTimes(1);
      expect(squadMembershipRepo.create).toHaveBeenCalledTimes(1);
      expect(result.league.id).toBe('new-league-id');
      expect(result.league.leagueCode).toBe('MYLEAGUE');
      expect(leagueRepo.findByCode).toHaveBeenCalledWith('MYLEAGUE');
    });

    it('applies the default first-class lifecycle fields', async () => {
      const leagueRepo = createMockLeagueRepo();
      const membershipRepo = createMockMembershipRepo();
      const service = new LeagueService(
        leagueRepo,
        membershipRepo,
        createMockSquadRepo(),
        createMockSquadMembershipRepo(),
        createMockProvisioningPrisma() as any,
      );
      await service.createLeague({
        createdBy: 'user-1',
        name: 'My League',
        leagueCode: 'MYLEAGUE',
      });
      const createArg = (leagueRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.isActive).toBe(true);
      expect(createArg.joinPolicy).toBe(JoinPolicy.COMMISSIONER_ONLY);
    });

    it('rejects duplicate league codes', async () => {
      const leagueRepo = createMockLeagueRepo({
        findByCode: jest.fn().mockResolvedValue(buildLeague({ leagueCode: 'MYLEAGUE' })),
      });
      const membershipRepo = createMockMembershipRepo();
      const service = new LeagueService(
        leagueRepo,
        membershipRepo,
        createMockSquadRepo(),
        createMockSquadMembershipRepo(),
        createMockProvisioningPrisma() as any,
      );

      await expect(
        service.createLeague({
          createdBy: 'user-1',
          name: 'My League',
          leagueCode: 'MYLEAGUE',
        }),
      ).rejects.toMatchObject({
        code: 'LEAGUE_CODE_CONFLICT',
        statusCode: 409,
      });

      expect(leagueRepo.create).not.toHaveBeenCalled();
      expect(membershipRepo.create).not.toHaveBeenCalled();
    });
  });

  /**
   * #202 — `listLeagues`, the collapse of `listLeagues` + `adminListLeagues`.
   *
   * These cases migrated from `admin-league-service.test.ts` with the code they cover
   * (`rules/testing-rules.md` §1D): the composition they assert — filters handed to the port,
   * counts joined onto the right league, no count query for an empty result — did not change,
   * only its home did. The scope cases below are new, because the parameter is new.
   */
  describe('listLeagues', () => {
    function createCountingPrisma(
      contestRows: Array<{ leagueId: string; _count: { _all: number } }> = [],
    ) {
      return {
        contest: { groupBy: jest.fn().mockResolvedValue(contestRows) },
      } as any;
    }

    function createService(options: {
      leagueRepo?: LeagueRepository;
      membershipRepo?: LeagueMembershipRepository;
      prisma?: unknown;
    } = {}) {
      return new LeagueService(
        options.leagueRepo ?? createMockLeagueRepo(),
        options.membershipRepo ?? createMockMembershipRepo(),
        createMockSquadRepo(),
        createMockSquadMembershipRepo(),
        (options.prisma ?? createCountingPrisma()) as any,
      );
    }

    it('reads every league for scope "all" and only the viewer\'s for scope "mine"', async () => {
      const leagueRepo = createMockLeagueRepo({
        findAll: jest.fn().mockResolvedValue([buildLeague({ id: 'league-1' })]),
        findByUser: jest.fn().mockResolvedValue([buildLeague({ id: 'league-2' })]),
      });

      const all = await createService({ leagueRepo }).listLeagues({
        scope: 'all',
        userId: 'user-1',
      });
      const mine = await createService({ leagueRepo }).listLeagues({
        scope: 'mine',
        userId: 'user-1',
      });

      // The scope picks the read. Authorization for 'all' is the route's job — a service
      // cannot see the request — and is asserted in the league route tests.
      expect(all.map((row) => row.league.id)).toEqual(['league-1']);
      expect(mine.map((row) => row.league.id)).toEqual(['league-2']);
    });

    it('passes the search and isActive filters to the port rather than building a query', async () => {
      const leagueRepo = createMockLeagueRepo();

      await createService({ leagueRepo }).listLeagues({
        scope: 'all',
        userId: 'user-1',
        filters: { search: 'Ryder', isActive: true },
      });

      // Handed over as filters — the service composes, it does not query.
      expect(leagueRepo.findAll).toHaveBeenCalledWith({ search: 'Ryder', isActive: true });
    });

    it('applies the same filters to the member-scoped read, which never had them', async () => {
      const leagueRepo = createMockLeagueRepo({
        findByUser: jest.fn().mockResolvedValue([
          buildLeague({ id: 'league-1', name: 'Ryder Cup Pool', isActive: true }),
          buildLeague({ id: 'league-2', name: 'Masters Pool', isActive: true }),
          buildLeague({ id: 'league-3', name: 'Ryder Cup Legacy', isActive: false }),
        ]),
      });

      const rows = await createService({ leagueRepo }).listLeagues({
        scope: 'mine',
        userId: 'user-1',
        filters: { search: 'ryder', isActive: true },
      });

      // `search` and `isActive` existed only on the root-admin half. They describe the query,
      // not the caller, so they narrow either scope — case-insensitively.
      expect(rows.map((row) => row.league.id)).toEqual(['league-1']);
    });

    it('joins member and active-contest counts onto the right leagues', async () => {
      const leagueRepo = createMockLeagueRepo({
        findAll: jest.fn().mockResolvedValue([
          buildLeague({ id: 'league-1', name: 'First' }),
          buildLeague({ id: 'league-2', name: 'Second' }),
        ]),
      });
      const membershipRepo = createMockMembershipRepo({
        countActiveByLeagues: jest.fn().mockResolvedValue(new Map([['league-1', 4]])),
        findByUser: jest.fn().mockResolvedValue([]),
      });

      const rows = await createService({
        leagueRepo,
        membershipRepo,
        prisma: createCountingPrisma([{ leagueId: 'league-2', _count: { _all: 7 } }]),
      }).listLeagues({ scope: 'all', userId: 'user-1' });

      expect(membershipRepo.countActiveByLeagues).toHaveBeenCalledWith(['league-1', 'league-2']);
      // Counts land on their own league, and a league absent from a count map reads 0
      // rather than undefined.
      expect(rows).toEqual([
        expect.objectContaining({ memberCount: 4, activeContestCount: 0 }),
        expect.objectContaining({ memberCount: 0, activeContestCount: 7 }),
      ]);
    });

    it('counts the member-scoped list too, which used to report every league as empty', async () => {
      const leagueRepo = createMockLeagueRepo({
        findByUser: jest.fn().mockResolvedValue([buildLeague({ id: 'league-1' })]),
      });
      const membershipRepo = createMockMembershipRepo({
        countActiveByLeagues: jest.fn().mockResolvedValue(new Map([['league-1', 9]])),
        findByUser: jest.fn().mockResolvedValue([]),
      });

      const [row] = await createService({
        leagueRepo,
        membershipRepo,
        prisma: createCountingPrisma([{ leagueId: 'league-1', _count: { _all: 2 } }]),
      }).listLeagues({ scope: 'mine', userId: 'user-1' });

      // The defect the collapse fixed: the member list called the mapper with no counts, so
      // every league it returned reported memberCount 0 and activeContestCount 0 while the
      // root-admin list reported the truth. One operation cannot hold both answers.
      expect(row).toEqual(
        expect.objectContaining({ memberCount: 9, activeContestCount: 2 }),
      );
    });

    it('issues a fixed number of reads however many leagues the user belongs to', async () => {
      // #202 — the guard against the N+1 returning, migrated here with `findByUser` (§1D).
      // Three memberships used to mean three `findById` calls on top of the membership read;
      // the scoped list is one league read plus one membership read, whatever the count.
      const leagues = ['league-1', 'league-2', 'league-3'].map((id) => buildLeague({ id }));
      const leagueRepo = createMockLeagueRepo({
        findByUser: jest.fn().mockResolvedValue(leagues),
      });
      const membershipRepo = createMockMembershipRepo({
        findByUser: jest.fn().mockResolvedValue(
          leagues.map((league) => buildMembership({ leagueId: league.id, userId: 'user-1' })),
        ),
        countActiveByLeagues: jest.fn().mockResolvedValue(new Map()),
      });

      const rows = await createService({ leagueRepo, membershipRepo }).listLeagues({
        scope: 'mine',
        userId: 'user-1',
      });

      expect(rows).toHaveLength(3);
      expect(leagueRepo.findByUser).toHaveBeenCalledTimes(1);
      expect(membershipRepo.findByUser).toHaveBeenCalledTimes(1);
      expect(leagueRepo.findById).not.toHaveBeenCalled();
      // And each league keeps its own membership, which is what the pairing is for.
      expect(rows.map((row) => row.membership?.leagueId)).toEqual([
        'league-1',
        'league-2',
        'league-3',
      ]);
    });

    it('does not query counts when no leagues matched', async () => {
      const membershipRepo = createMockMembershipRepo({
        findByUser: jest.fn().mockResolvedValue([]),
      });
      const prisma = createCountingPrisma();

      await expect(
        createService({ membershipRepo, prisma }).listLeagues({ scope: 'all', userId: 'user-1' }),
      ).resolves.toEqual([]);

      // An empty `in` list would scan; both count reads are skipped entirely.
      expect(membershipRepo.countActiveByLeagues).not.toHaveBeenCalled();
      expect(prisma.contest.groupBy).not.toHaveBeenCalled();
    });

    it('attaches the viewer\'s own membership, and null for a league they do not belong to', async () => {
      const leagueRepo = createMockLeagueRepo({
        findAll: jest.fn().mockResolvedValue([
          buildLeague({ id: 'league-mine' }),
          buildLeague({ id: 'league-theirs' }),
        ]),
      });
      const membershipRepo = createMockMembershipRepo({
        findByUser: jest.fn().mockResolvedValue([
          buildMembership({ id: 'membership-1', leagueId: 'league-mine', userId: 'user-1' }),
        ]),
        countActiveByLeagues: jest.fn().mockResolvedValue(new Map()),
      });

      const rows = await createService({ leagueRepo, membershipRepo }).listLeagues({
        scope: 'all',
        userId: 'user-1',
      });

      // A8's one exception is a SET of the viewer's memberships beside the leagues, so a
      // root admin listing leagues they do not belong to gets null — not an invented
      // relationship, which is what the deleted `adminListLeagues` used to fabricate.
      expect(rows[0]?.membership?.id).toBe('membership-1');
      expect(rows[1]?.membership).toBeNull();
    });

    it('returns leagues carrying no viewer context on the league itself (A8)', async () => {
      const leagueRepo = createMockLeagueRepo({
        findAll: jest.fn().mockResolvedValue([buildLeague({ id: 'league-1' })]),
      });

      const [row] = await createService({ leagueRepo }).listLeagues({
        scope: 'all',
        userId: 'user-1',
      });

      // The admin list used to hard-code `isRootAdmin: true`, `memberType: null` and an
      // all-false `leagueRelationship` on every row: a caller having to INVENT values for
      // three fields is what proved they were never properties of the league.
      expect(row?.league.id).toBe('league-1');
      expect(row?.league).not.toHaveProperty('isRootAdmin');
      expect(row?.league).not.toHaveProperty('memberType');
      expect(row?.league).not.toHaveProperty('leagueRelationship');
    });
  });

  describe('inactivateLeague', () => {
    it('marks an active league inactive', async () => {
      const existingLeague = buildLeague({
        id: 'league-1',
        isActive: true,
      });
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(existingLeague),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());

      await service.inactivateLeague('league-1');

      expect(leagueRepo.update).toHaveBeenCalledWith(
        'league-1',
        expect.objectContaining({
          isActive: false,
        }),
      );
    });

    it('rejects inactivation when the league is already inactive', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({
          id: 'league-1',
          isActive: false,
        })),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());

      await expect(service.inactivateLeague('league-1')).rejects.toMatchObject({
        code: 'LEAGUE_ALREADY_INACTIVE',
        statusCode: 400,
      });
    });
  });

  describe('activateLeague', () => {
    it('pool-master-4uq: marks an inactive league active', async () => {
      const existingLeague = buildLeague({
        id: 'league-1',
        isActive: false,
      });
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(existingLeague),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());

      await service.activateLeague('league-1');

      expect(leagueRepo.update).toHaveBeenCalledWith(
        'league-1',
        expect.objectContaining({
          isActive: true,
        }),
      );
    });

    it('pool-master-4uq: rejects activation when the league is already active', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({
          id: 'league-1',
          isActive: true,
        })),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());

      await expect(service.activateLeague('league-1')).rejects.toMatchObject({
        code: 'LEAGUE_ALREADY_ACTIVE',
        statusCode: 400,
      });
    });
  });

  describe('updateLeagueDetails', () => {
    it('updates name and description for an active league', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({
          id: 'league-1',
          isActive: true,
        })),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());

      await service.updateLeagueDetails('league-1', {
        name: 'Updated League',
        description: 'Updated description',
      });

      expect(leagueRepo.update).toHaveBeenCalledWith(
        'league-1',
        expect.objectContaining({
          name: 'Updated League',
          description: 'Updated description',
        }),
      );
    });

    it('rejects details updates once a league is inactive', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({
          id: 'league-1',
          isActive: false,
        })),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());

      await expect(
        service.updateLeagueDetails('league-1', {
          name: 'Updated League',
          description: 'Updated description',
        }),
      ).rejects.toMatchObject({
        code: 'LEAGUE_DETAILS_READ_ONLY_WHEN_INACTIVE',
        statusCode: 400,
      });
    });
  });

  describe('updateLeagueIcon', () => {
    it('updates the built-in icon for an active league', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({
          id: 'league-1',
          isActive: true,
        })),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());

      await service.updateLeagueIcon('league-1', {
        iconKey: LeagueIconKey.SOCCER_BALL,
      });

      expect(leagueRepo.update).toHaveBeenCalledWith(
        'league-1',
        expect.objectContaining({
          iconKey: LeagueIconKey.SOCCER_BALL,
        }),
      );
    });

    it('rejects icon updates once a league is inactive', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({
          id: 'league-1',
          isActive: false,
        })),
      });
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());

      await expect(
        service.updateLeagueIcon('league-1', {
          iconKey: LeagueIconKey.SOCCER_BALL,
        }),
      ).rejects.toMatchObject({
        code: 'LEAGUE_ICON_READ_ONLY_WHEN_INACTIVE',
        statusCode: 400,
      });
    });
  });

  describe('deleteInactiveLeague', () => {
    it('rejects deleting an active league', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({
          id: 'league-1',
          leagueCode: 'ACTIVE1',
          isActive: true,
        })),
      });
      const { prisma } = createMockLifecyclePrisma();
      const service = new LeagueService(
        leagueRepo,
        createMockMembershipRepo(),
        undefined,
        undefined,
        prisma as never,
      );

      await expect(service.deleteInactiveLeague('league-1', 'ACTIVE1')).rejects.toMatchObject({
        code: 'LEAGUE_DELETE_REQUIRES_INACTIVE',
        statusCode: 400,
      });
    });

    it('rejects deleting when the confirmation code does not match', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({
          id: 'league-1',
          leagueCode: 'RIGHT123',
          isActive: false,
        })),
      });
      const { prisma } = createMockLifecyclePrisma();
      const service = new LeagueService(
        leagueRepo,
        createMockMembershipRepo(),
        prisma as never,
      );

      await expect(service.deleteInactiveLeague('league-1', 'WRONG123')).rejects.toMatchObject({
        code: 'LEAGUE_DELETE_CONFIRMATION_MISMATCH',
        statusCode: 400,
      });
    });

    it('deletes league-owned rows in a transaction while preserving user accounts', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(buildLeague({
          id: 'league-1',
          leagueCode: 'DELETE01',
          isActive: false,
        })),
      });
      const { prisma, tx } = createMockLifecyclePrisma();
      const service = new LeagueService(
        leagueRepo,
        createMockMembershipRepo(),
        undefined,
        undefined,
        prisma as never,
      );

      await service.deleteInactiveLeague('league-1', 'DELETE01');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.contest.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'league-1' } });
      expect(tx.leagueMembership.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'league-1' } });
      expect(tx.league.delete).toHaveBeenCalledWith({ where: { id: 'league-1' } });
    });
  });

  describe('getLeagueWithMembers', () => {
    it('returns league and members', async () => {
      const league = buildLeague({ id: 'league-1' });
      const members = [buildMembership({ leagueId: 'league-1' })];
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(league),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeague: jest.fn().mockResolvedValue(members),
      });
      const service = new LeagueService(leagueRepo, membershipRepo);
      const result = await service.getLeagueWithMembers('league-1');
      expect(result).not.toBeNull();
      expect(result!.league.id).toBe('league-1');
      expect(result!.members).toHaveLength(1);
    });

    it('returns null for missing league', async () => {
      const leagueRepo = createMockLeagueRepo();
      const service = new LeagueService(leagueRepo, createMockMembershipRepo());
      const result = await service.getLeagueWithMembers('missing');
      expect(result).toBeNull();
    });
  });
});
