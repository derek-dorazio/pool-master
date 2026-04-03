import {
  ContestService,
  ContestNotFoundError,
  ContestOperationError,
  registerScoringTemplates,
} from '../../../packages/core-api/src/modules/contests/service';
import type {
  ContestRepository,
  ContestEntryRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SelectionConfigRepository,
} from '@poolmaster/shared/db';
import { ContestStatus, SelectionType, ScoringEngine, ContestType } from '@poolmaster/shared/domain';
import { buildContest, buildLeague, buildMembership, buildUser } from '../../factories';

beforeAll(() => {
  registerScoringTemplates({
    golf_dfs_standard: { sport: 'GOLF', scoring_type: 'CUMULATIVE', stat_rules: [{ stat_key: 'birdie', points_per_unit: 3 }] },
  });
});

function createMockContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByLeague: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-contest-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      ...buildContest({ id }),
      ...updates,
    })),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockSelectionConfigRepo(
  overrides: Partial<SelectionConfigRepository> = {},
): SelectionConfigRepository {
  return {
    findByContest: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'new-config-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({ id, ...updates })),
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
    create: jest.fn().mockResolvedValue(buildMembership()),
    update: jest.fn().mockResolvedValue(buildMembership()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockEntryRepo(overrides: Partial<ContestEntryRepository> = {}): ContestEntryRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByContest: jest.fn().mockResolvedValue([]),
    findByMember: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'entry-1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      contestId: 'contest-1',
      leagueMembershipId: 'membership-1',
      name: 'Entry',
      totalScore: 0,
      isEliminated: false,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      ...updates,
    })),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockLeagueRepo(overrides: Partial<LeagueRepository> = {}): LeagueRepository {
  return {
    findById: jest.fn().mockResolvedValue(buildLeague({ id: 'league-1' })),
    findByTenant: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(buildLeague()),
    update: jest.fn().mockResolvedValue(buildLeague()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockPrisma(overrides: Record<string, unknown> = {}) {
  const user = buildUser({ id: 'user-1', displayName: 'Derek' });
  return {
    contestEntry: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'entry-1',
          contestId: 'contest-1',
          leagueMembershipId: 'membership-1',
          name: "Derek's Entry",
          totalScore: 0,
          rank: null,
          isEliminated: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          membership: {
            id: 'membership-1',
            userId: user.id,
            user,
          },
        },
      ]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'entry-1',
        contestId: 'contest-1',
        leagueMembershipId: 'membership-1',
        name: "Derek's Entry",
        totalScore: 0,
        rank: null,
        isEliminated: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        membership: {
          id: 'membership-1',
          userId: user.id,
          user,
        },
      }),
    },
    rosterPick: { count: jest.fn().mockResolvedValue(0) },
    contestPick: { count: jest.fn().mockResolvedValue(0) },
    bracketPrediction: { count: jest.fn().mockResolvedValue(0) },
    draftPick: { count: jest.fn().mockResolvedValue(0) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    ...overrides,
  };
}

describe('ContestService', () => {
  describe('createContest', () => {
    it('creates a contest and selection config', async () => {
      const contestRepo = createMockContestRepo();
      const selectionConfigRepo = createMockSelectionConfigRepo();
      const service = new ContestService(
        contestRepo,
        selectionConfigRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      const result = await service.createContest({
        leagueId: 'league-1',
        tenantId: 'tenant-1',
        createdBy: 'user-1',
        name: 'Masters Pool',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        selectionConfig: { rounds: 5, timePerPickSeconds: 60 },
        scoringEngine: ScoringEngine.STROKE_PLAY,
        scoringRules: { missedCutPenalty: 80 },
      });
      expect(contestRepo.create).toHaveBeenCalledTimes(1);
      expect(selectionConfigRepo.create).toHaveBeenCalledTimes(1);
      expect(result.contest.id).toBe('new-contest-id');
      expect(result.selectionConfig.id).toBe('new-config-id');
    });

    it('creates contest with status DRAFT', async () => {
      const contestRepo = createMockContestRepo();
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.createContest({
        leagueId: 'league-1',
        tenantId: 'tenant-1',
        createdBy: 'user-1',
        name: 'Test',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        selectionConfig: {},
        scoringEngine: ScoringEngine.CUMULATIVE,
      });
      const createArg = (contestRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.status).toBe(ContestStatus.DRAFT);
    });

    it('throws when league not found', async () => {
      const leagueRepo = createMockLeagueRepo({
        findById: jest.fn().mockResolvedValue(null),
      });
      const service = new ContestService(
        createMockContestRepo(),
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        leagueRepo,
      );
      await expect(
        service.createContest({
          leagueId: 'missing',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          name: 'Test',
          contestType: ContestType.SINGLE_EVENT,
          selectionType: SelectionType.SNAKE_DRAFT,
          selectionConfig: {},
          scoringEngine: ScoringEngine.CUMULATIVE,
        }),
      ).rejects.toThrow(ContestOperationError);
    });

    it('resolves scoring template key to scoring rules', async () => {
      const contestRepo = createMockContestRepo();
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.createContest({
        leagueId: 'league-1',
        tenantId: 'tenant-1',
        createdBy: 'user-1',
        name: 'Golf Pool',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        selectionConfig: {},
        scoringEngine: ScoringEngine.STROKE_PLAY,
        scoringTemplateKey: 'golf_dfs_standard',
      });
      const createArg = (contestRepo.create as jest.Mock).mock.calls[0][0];
      expect(createArg.scoringRules).toBeDefined();
      expect((createArg.scoringRules as Record<string, unknown>).sport).toBe('GOLF');
    });

    it('throws for unknown scoring template key', async () => {
      const service = new ContestService(
        createMockContestRepo(),
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(
        service.createContest({
          leagueId: 'league-1',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          name: 'Test',
          contestType: ContestType.SINGLE_EVENT,
          selectionType: SelectionType.SNAKE_DRAFT,
          selectionConfig: {},
          scoringEngine: ScoringEngine.CUMULATIVE,
          scoringTemplateKey: 'nonexistent_template',
        }),
      ).rejects.toThrow(ContestOperationError);
    });

    it('validates payout config — rejects duplicate ranks', async () => {
      const service = new ContestService(
        createMockContestRepo(),
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(
        service.createContest({
          leagueId: 'league-1',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          name: 'Test',
          contestType: ContestType.SINGLE_EVENT,
          selectionType: SelectionType.SNAKE_DRAFT,
          selectionConfig: {},
          scoringEngine: ScoringEngine.CUMULATIVE,
          payoutConfig: {
            payoutStructure: [
              { rank: 1, percentage: 60 },
              { rank: 1, percentage: 40 },
            ],
            intermediatePrizes: [],
          },
        }),
      ).rejects.toThrow('duplicate ranks');
    });

    it('validates payout config — rejects percentages over 100', async () => {
      const service = new ContestService(
        createMockContestRepo(),
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(
        service.createContest({
          leagueId: 'league-1',
          tenantId: 'tenant-1',
          createdBy: 'user-1',
          name: 'Test',
          contestType: ContestType.SINGLE_EVENT,
          selectionType: SelectionType.SNAKE_DRAFT,
          selectionConfig: {},
          scoringEngine: ScoringEngine.CUMULATIVE,
          payoutConfig: {
            payoutStructure: [
              { rank: 1, percentage: 70 },
              { rank: 2, percentage: 40 },
            ],
            intermediatePrizes: [],
          },
        }),
      ).rejects.toThrow('exceeds 100%');
    });
  });

  describe('updateContest', () => {
    it('updates a DRAFT contest', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.DRAFT });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.updateContest('c-1', 'tenant-1', { name: 'Updated Name' });
      expect(contestRepo.update).toHaveBeenCalledWith('c-1', { name: 'Updated Name' });
    });

    it('throws when contest is not in DRAFT status', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.ACTIVE });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(
        service.updateContest('c-1', 'tenant-1', { name: 'Updated' }),
      ).rejects.toThrow('DRAFT status');
    });

    it('throws ContestNotFoundError for missing contest', async () => {
      const service = new ContestService(
        createMockContestRepo(),
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(
        service.updateContest('missing', 'tenant-1', { name: 'X' }),
      ).rejects.toThrow(ContestNotFoundError);
    });
  });

  describe('deleteContest', () => {
    it('deletes a DRAFT contest', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.DRAFT });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.deleteContest('c-1', 'tenant-1');
      expect(contestRepo.delete).toHaveBeenCalledWith('c-1');
    });

    it('throws when contest is ACTIVE', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.ACTIVE });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(service.deleteContest('c-1', 'tenant-1')).rejects.toThrow(
        'DRAFT status',
      );
    });
  });

  describe('listByLeague', () => {
    it('returns contests for the league', async () => {
      const contests = [buildContest(), buildContest()];
      const contestRepo = createMockContestRepo({
        findByLeague: jest.fn().mockResolvedValue(contests),
      });
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      const result = await service.listByLeague('league-1');
      expect(result).toHaveLength(2);
    });
  });

  describe('getContest', () => {
    it('returns contest with selection config', async () => {
      const contest = buildContest({ id: 'c-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const configRepo = createMockSelectionConfigRepo({
        findByContest: jest.fn().mockResolvedValue({ id: 'cfg-1', contestId: 'c-1' }),
      });
      const service = new ContestService(
        contestRepo,
        configRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      const result = await service.getContest('c-1', 'tenant-1');
      expect(result).not.toBeNull();
      expect(result!.contest.id).toBe('c-1');
      expect(result!.selectionConfig).toBeDefined();
    });

    it('returns null for missing contest', async () => {
      const service = new ContestService(
        createMockContestRepo(),
        createMockSelectionConfigRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      const result = await service.getContest('missing', 'tenant-1');
      expect(result).toBeNull();
    });
  });

  describe('contest entries', () => {
    it('creates a real contest entry for the current league member', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const entryRepo = createMockEntryRepo({
        findByMember: jest.fn().mockResolvedValue([]),
      });
      const prisma = createMockPrisma();
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        entryRepo,
        prisma as any,
      );

      const result = await service.createEntry('contest-1', 'tenant-1', 'user-1');

      expect(result.created).toBe(true);
      expect(entryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        contestId: 'contest-1',
        leagueMembershipId: 'membership-1',
        name: "Derek's Entry",
      }));
    });

    it('returns the joined entry state for pre-draft contest views', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.DRAFT });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockEntryRepo(),
        createMockPrisma() as any,
      );

      const result = await service.listEntries('contest-1', 'tenant-1', 'user-1');

      expect(result.isJoined).toBe(true);
      expect(result.myEntryId).toBe('entry-1');
      expect(result.entries[0].ownerDisplayName).toBe('Derek');
    });

    it('rejects leaving a contest after picks already exist', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const entryRepo = createMockEntryRepo({
        findByMember: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            leagueMembershipId: 'membership-1',
            name: "Derek's Entry",
            totalScore: 0,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      });
      const prisma = createMockPrisma({
        rosterPick: { count: jest.fn().mockResolvedValue(1) },
      });
      const service = new ContestService(
        contestRepo,
        createMockSelectionConfigRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        entryRepo,
        prisma as any,
      );

      await expect(service.deleteMyEntry('contest-1', 'tenant-1', 'user-1')).rejects.toThrow(
        'Cannot leave a contest after making picks or draft selections',
      );
      expect(entryRepo.delete).not.toHaveBeenCalled();
    });
  });
});
