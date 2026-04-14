import {
  ContestService,
  ContestNotFoundError,
  ContestOperationError,
} from '../../../packages/core-api/src/modules/contests/service';
import type {
  ContestConfigurationRepository,
  ContestRepository,
  ContestEntryRepository,
  LeagueMembershipRepository,
  LeagueRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import {
  ContestStatus,
  SelectionType,
  ScoringEngine,
  ContestType,
  SquadMembershipStatus,
  SquadStatus,
} from '@poolmaster/shared/domain';
import { buildContest, buildLeague, buildMembership, buildUser } from '../../factories';

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

function createMockContestConfigurationRepo(
  overrides: Partial<ContestConfigurationRepository> = {},
): ContestConfigurationRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
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
    findBySquad: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'entry-1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    })),
    update: jest.fn().mockImplementation(async (id, updates) => ({
      id,
      contestId: 'contest-1',
      squadId: 'squad-1',
      entryNumber: 1,
      name: 'Ace Squad Entry 1',
      status: 'ACTIVE',
      totalScore: 0,
      standingsPosition: undefined,
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
    findByCode: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(buildLeague()),
    update: jest.fn().mockResolvedValue(buildLeague()),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockSquadRepo(overrides: Partial<SquadRepository> = {}): SquadRepository {
  return {
    findById: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: "Derek's Squad",
      iconUrl: undefined,
      status: SquadStatus.ACTIVE,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }),
    findByLeague: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: "Derek's Squad",
      iconUrl: undefined,
      status: SquadStatus.ACTIVE,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }),
    update: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  };
}

function createMockSquadMembershipRepo(
  overrides: Partial<SquadMembershipRepository> = {},
): SquadMembershipRepository {
  return {
    findBySquad: jest.fn().mockResolvedValue([]),
    findBySquadAndUser: jest.fn().mockResolvedValue(null),
    findByLeagueAndUser: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({
      id: 'squad-membership-1',
      squadId: 'squad-1',
      leagueId: 'league-1',
      userId: 'user-1',
      status: SquadMembershipStatus.ACTIVE,
      joinedAt: new Date('2026-01-01'),
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }),
    update: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  };
}

function createMockPrisma(overrides: Record<string, unknown> = {}) {
  const user = buildUser({ id: 'user-1', firstName: 'Derek', lastName: 'Dorazio' });
  return {
    contestEntry: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          entryNumber: 1,
          name: "Derek's Squad Entry 1",
          status: 'ACTIVE',
          totalScore: 0,
          standingsPosition: null,
          isEliminated: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          squad: { id: 'squad-1', name: "Derek's Squad" },
        },
      ]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'entry-1',
        contestId: 'contest-1',
        squadId: 'squad-1',
        entryNumber: 1,
        name: "Derek's Squad Entry 1",
        status: 'ACTIVE',
        totalScore: 0,
        standingsPosition: null,
        isEliminated: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        squad: { id: 'squad-1', name: "Derek's Squad" },
      }),
    },
    rosterPick: { count: jest.fn().mockResolvedValue(0) },
    contestPick: { count: jest.fn().mockResolvedValue(0) },
    bracketPrediction: { count: jest.fn().mockResolvedValue(0) },
    draftPickHistory: { count: jest.fn().mockResolvedValue(0) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    contestConfiguration: { findUnique: jest.fn().mockResolvedValue({ maxEntriesPerSquad: 1 }) },
    ...overrides,
  };
}

describe('ContestService', () => {
  describe('createContest', () => {
    it('creates a contest and selection config', async () => {
      const contestRepo = createMockContestRepo();
      const contestConfigurationRepo = createMockContestConfigurationRepo();
      const service = new ContestService(
        contestRepo,
        contestConfigurationRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      const result = await service.createContest({
        leagueId: 'league-1',
        createdBy: 'user-1',
        sportEventId: 'event-1',
        name: 'Masters Pool',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        contestConfiguration: { rounds: 5, timePerPickSeconds: 60 },
        scoringEngine: ScoringEngine.STROKE_PLAY,
      });
      expect(contestRepo.create).toHaveBeenCalledTimes(1);
      expect(contestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sportEventId: 'event-1',
        }),
      );
      expect(contestConfigurationRepo.create).toHaveBeenCalledTimes(1);
      expect(result.contest.id).toBe('new-contest-id');
      expect(result.contestConfiguration.id).toBe('new-config-id');
    });

    it('creates contest with status DRAFT', async () => {
      const contestRepo = createMockContestRepo();
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.createContest({
        leagueId: 'league-1',
        createdBy: 'user-1',
        name: 'Test',
        contestType: ContestType.SINGLE_EVENT,
        selectionType: SelectionType.SNAKE_DRAFT,
        contestConfiguration: {},
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
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        leagueRepo,
      );
      await expect(
        service.createContest({
          leagueId: 'missing',
          createdBy: 'user-1',
          name: 'Test',
          contestType: ContestType.SINGLE_EVENT,
          selectionType: SelectionType.SNAKE_DRAFT,
          contestConfiguration: {},
          scoringEngine: ScoringEngine.CUMULATIVE,
        }),
      ).rejects.toThrow(ContestOperationError);
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
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.updateContest('c-1', { name: 'Updated Name' });
      expect(contestRepo.update).toHaveBeenCalledWith('c-1', { name: 'Updated Name' });
    });

    it('throws when contest is not in DRAFT status', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.ACTIVE });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(
        service.updateContest('c-1', { name: 'Updated' }),
      ).rejects.toThrow('DRAFT status');
    });

    it('throws ContestNotFoundError for missing contest', async () => {
      const service = new ContestService(
        createMockContestRepo(),
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(
        service.updateContest('missing', { name: 'X' }),
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
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await service.deleteContest('c-1');
      expect(contestRepo.delete).toHaveBeenCalledWith('c-1');
    });

    it('throws when contest is ACTIVE', async () => {
      const contest = buildContest({ id: 'c-1', status: ContestStatus.ACTIVE });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      await expect(service.deleteContest('c-1')).rejects.toThrow(
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
        createMockContestConfigurationRepo(),
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
      const configRepo = createMockContestConfigurationRepo({
        findByContest: jest.fn().mockResolvedValue({ id: 'cfg-1', contestId: 'c-1' }),
      });
      const service = new ContestService(
        contestRepo,
        configRepo,
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      const result = await service.getContest('c-1');
      expect(result).not.toBeNull();
      expect(result!.contest.id).toBe('c-1');
      expect(result!.contestConfiguration).toBeDefined();
    });

    it('returns null for missing contest', async () => {
      const service = new ContestService(
        createMockContestRepo(),
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
      );
      const result = await service.getContest('missing');
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
        findBySquad: jest.fn().mockResolvedValue([]),
      });
      const prisma = createMockPrisma();
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockSquadRepo(),
        createMockSquadMembershipRepo(),
        entryRepo,
        prisma as any,
      );

      const result = await service.createEntry('contest-1', 'user-1');

      expect(result.created).toBe(true);
      expect(entryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        contestId: 'contest-1',
        squadId: 'squad-1',
        entryNumber: 1,
        name: "Derek's Squad Entry 1",
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
        createMockContestConfigurationRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockSquadRepo(),
        createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue({
            id: 'squad-membership-1',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-1',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date('2026-01-01'),
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          }),
        }),
        createMockEntryRepo(),
        createMockPrisma() as any,
      );

      const result = await service.listEntries('contest-1', 'user-1');

      expect(result.isJoined).toBe(true);
      expect(result.myEntryId).toBe('entry-1');
      expect(result.entries[0].squadName).toBe("Derek's Squad");
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
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            status: 'ACTIVE',
            totalScore: 0,
            standingsPosition: undefined,
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
        createMockContestConfigurationRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockSquadRepo(),
        createMockSquadMembershipRepo({
          findByLeagueAndUser: jest.fn().mockResolvedValue({
            id: 'squad-membership-1',
            squadId: 'squad-1',
            leagueId: 'league-1',
            userId: 'user-1',
            status: SquadMembershipStatus.ACTIVE,
            joinedAt: new Date('2026-01-01'),
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          }),
        }),
        entryRepo,
        prisma as any,
      );

      await expect(service.deleteMyEntry('contest-1', 'user-1')).rejects.toThrow(
        'Cannot leave a contest after making picks or draft selections',
      );
      expect(entryRepo.delete).not.toHaveBeenCalled();
    });
  });
});
