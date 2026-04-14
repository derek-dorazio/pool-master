import { LeagueService } from '../../../packages/core-api/src/modules/leagues/service';
import type { LeagueMembershipRepository, LeagueRepository } from '@poolmaster/shared/db';
import { JoinPolicy, LeagueRole } from '@poolmaster/shared/domain';
import { buildLeague, buildMembership } from '../../factories';

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByCode: jest.fn().mockResolvedValue(null),
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
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockMembershipRepo(
  overrides: Partial<LeagueMembershipRepository> = {},
): LeagueMembershipRepository {
  return {
    findByLeague: jest.fn().mockResolvedValue([]),
    findByUser: jest.fn().mockResolvedValue([]),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-membership-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockResolvedValue(buildMembership()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockLifecyclePrisma() {
  const tx = {
    contestEntryParticipantScoreEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    draftPickHistory: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestEntryParticipantScore: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestEntryPrizeAward: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    rosterPick: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    draftSession: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    participantContestScoringRule: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestEntryAggregationRule: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestPrizeDefinition: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contestConfiguration: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contest: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    commissionerActionItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    commissionerAuditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
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
      const service = new LeagueService(leagueRepo, membershipRepo);
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
      expect(result.league.id).toBe('new-league-id');
      expect(result.league.leagueCode).toBe('MYLEAGUE');
      expect(leagueRepo.findByCode).toHaveBeenCalledWith('MYLEAGUE');
    });

    it('applies the default first-class lifecycle fields', async () => {
      const leagueRepo = createMockLeagueRepo();
      const membershipRepo = createMockMembershipRepo();
      const service = new LeagueService(leagueRepo, membershipRepo);
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
      const service = new LeagueService(leagueRepo, membershipRepo);

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

  describe('findByUser', () => {
    it('loads leagues through active memberships instead of tenant scope', async () => {
      const expectedLeague = buildLeague({ id: 'league-1' });
      const expectedMembership = buildMembership({ leagueId: 'league-1', userId: 'user-1' });
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(expectedLeague),
      });
      const membershipRepo = createMockMembershipRepo({
        findByUser: jest.fn().mockResolvedValue([expectedMembership]),
      });
      const service = new LeagueService(leagueRepo, membershipRepo);

      const result = await service.findByUser('user-1');

      expect(membershipRepo.findByUser).toHaveBeenCalledWith('user-1');
      expect(leagueRepo.findById).toHaveBeenCalledWith('league-1');
      expect(result).toEqual([
        {
          league: expectedLeague,
          membership: expectedMembership,
        },
      ]);
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
