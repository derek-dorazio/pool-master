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
  ContestFormat,
  Sport,
  SquadMembershipStatus,
  TeamIconKey,
  TournamentFormat,
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
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }),
    findByLeague: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({
      id: 'squad-1',
      leagueId: 'league-1',
      createdBy: 'user-1',
      name: "Derek's Squad",
      iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
      isActive: true,
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
          tiebreakerValue: null,
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
        tiebreakerValue: null,
        totalScore: 0,
        standingsPosition: null,
        isEliminated: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        squad: { id: 'squad-1', name: "Derek's Squad" },
      }),
    },
    contestEntryPick: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    contestPick: { count: jest.fn().mockResolvedValue(0) },
    bracketPrediction: { count: jest.fn().mockResolvedValue(0) },
    draftPickHistory: { count: jest.fn().mockResolvedValue(0) },
    sportEventParticipant: { count: jest.fn().mockResolvedValue(1) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    contestConfiguration: { findUnique: jest.fn().mockResolvedValue({ maxEntriesPerSquad: 1 }) },
    sportEvent: {
      findUnique: jest.fn().mockResolvedValue({
        sport: Sport.GOLF,
      }),
    },
    sport: {
      findUnique: jest.fn().mockResolvedValue({
        tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
      }),
    },
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
        contestFormat: ContestFormat.ROSTER,
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
        contestFormat: ContestFormat.ROSTER,
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
          contestFormat: ContestFormat.ROSTER,
          selectionType: SelectionType.SNAKE_DRAFT,
          contestConfiguration: {},
          scoringEngine: ScoringEngine.CUMULATIVE,
        }),
      ).rejects.toThrow(ContestOperationError);
    });

    it('pool-master-rop.78.14 rejects invalid contest format for the selected sport event', async () => {
      const contestRepo = createMockContestRepo();
      const prisma = createMockPrisma({
        sportEvent: {
          findUnique: jest.fn().mockResolvedValue({
            sport: Sport.GOLF,
          }),
        },
        sport: {
          findUnique: jest.fn().mockResolvedValue({
            tournamentFormat: TournamentFormat.STROKE_PLAY_TOURNAMENT,
          }),
        },
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
        undefined,
        undefined,
        undefined,
        prisma as any,
      );

      await expect(
        service.createContest({
          leagueId: 'league-1',
          createdBy: 'user-1',
          sportEventId: 'event-1',
          name: 'Invalid Bracket',
          contestFormat: ContestFormat.BRACKET,
          selectionType: SelectionType.TIERED,
          contestConfiguration: {},
          scoringEngine: ScoringEngine.STROKE_PLAY,
        }),
      ).rejects.toMatchObject({
        code: 'CONTEST_FORMAT_NOT_ALLOWED',
        message: 'Selected sporting event does not support that contest format.',
      });
      expect(contestRepo.create).not.toHaveBeenCalled();
    });

    it('pool-master-rop.78.14 rejects valid future formats until creation support exists', async () => {
      const contestRepo = createMockContestRepo();
      const prisma = createMockPrisma({
        sportEvent: {
          findUnique: jest.fn().mockResolvedValue({
            sport: Sport.NCAA_BASKETBALL,
          }),
        },
        sport: {
          findUnique: jest.fn().mockResolvedValue({
            tournamentFormat: TournamentFormat.KNOCKOUT_BRACKET,
          }),
        },
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
        undefined,
        undefined,
        undefined,
        prisma as any,
      );

      await expect(
        service.createContest({
          leagueId: 'league-1',
          createdBy: 'user-1',
          sportEventId: 'event-1',
          name: 'Bracket Pool',
          contestFormat: ContestFormat.BRACKET,
          selectionType: SelectionType.TIERED,
          contestConfiguration: {},
          scoringEngine: ScoringEngine.BRACKET,
        }),
      ).rejects.toMatchObject({
        code: 'CONTEST_FORMAT_NOT_SUPPORTED',
        message: 'This contest format is not available for contest creation yet.',
      });
      expect(contestRepo.create).not.toHaveBeenCalled();
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

    it('pool-master-d0v counts entries for league contest summaries', async () => {
      const [firstContest, secondContest] = [
        buildContest({ id: 'contest-1' }),
        buildContest({ id: 'contest-2' }),
      ];
      const contestRepo = createMockContestRepo({
        findByLeague: jest.fn().mockResolvedValue([firstContest, secondContest]),
      });
      const entryRepo = createMockEntryRepo({
        findByContest: jest.fn()
          .mockResolvedValueOnce([
            { id: 'entry-1' },
            { id: 'entry-2' },
          ])
          .mockResolvedValueOnce([{ id: 'entry-3' }]),
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
        undefined,
        undefined,
        entryRepo,
      );

      const counts = await service.countEntriesByContest(['contest-1', 'contest-2']);

      expect(counts).toEqual(new Map([
        ['contest-1', 2],
        ['contest-2', 1],
      ]));
      expect(entryRepo.findByContest).toHaveBeenCalledWith('contest-1');
      expect(entryRepo.findByContest).toHaveBeenCalledWith('contest-2');
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
      const squadMembershipRepo = createMockSquadMembershipRepo({
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
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockSquadRepo(),
        squadMembershipRepo,
        entryRepo,
        prisma as any,
      );

      const result = await service.createEntry('contest-1', 'user-1');

      expect(result.id).toBe('entry-1');
      expect(entryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        contestId: 'contest-1',
        squadId: 'squad-1',
        entryNumber: 1,
        name: "Derek's Squad Entry 1",
      }));
    });

    it('rejects contest entry creation when the league member has no active squad', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
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
          findByLeagueAndUser: jest.fn().mockResolvedValue(null),
        }),
        createMockEntryRepo(),
        createMockPrisma() as any,
      );

      await expect(service.createEntry('contest-1', 'user-1')).rejects.toMatchObject({
        code: 'SQUAD_MEMBERSHIP_REQUIRED',
      });
    });

    it('rejects contest entry creation once the squad reaches the configured entry cap', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const squadMembershipRepo = createMockSquadMembershipRepo({
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
        contestConfiguration: { findUnique: jest.fn().mockResolvedValue({ maxEntriesPerSquad: 1 }) },
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockSquadRepo(),
        squadMembershipRepo,
        entryRepo,
        prisma as any,
      );

      await expect(service.createEntry('contest-1', 'user-1')).rejects.toMatchObject({
        code: 'CONTEST_ENTRY_LIMIT_REACHED',
      });
      expect(entryRepo.create).not.toHaveBeenCalled();
    });

    it('pool-master-284 rejects contest entry creation when the event field has not synced', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventId: 'sport-event-1',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const squadMembershipRepo = createMockSquadMembershipRepo({
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
      });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([]),
      });
      const prisma = createMockPrisma({
        sportEventParticipant: { count: jest.fn().mockResolvedValue(0) },
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockSquadRepo(),
        squadMembershipRepo,
        entryRepo,
        prisma as any,
      );

      await expect(service.createEntry('contest-1', 'user-1')).rejects.toMatchObject({
        code: 'CONTEST_ENTRY_FIELD_NOT_LOADED',
        message: 'Contest entries are not available until the event participant field has loaded.',
      });
      expect(prisma.sportEventParticipant.count).toHaveBeenCalledWith({
        where: { sportEventId: 'sport-event-1' },
      });
      expect(entryRepo.create).not.toHaveBeenCalled();
    });

    it('allows additional entry creation when the contest configuration is unlimited', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.OPEN });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(membership),
      });
      const squadMembershipRepo = createMockSquadMembershipRepo({
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
        contestEntry: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'entry-2',
              contestId: 'contest-1',
              squadId: 'squad-1',
              entryNumber: 2,
              name: "Derek's Squad Entry 2",
              status: 'ACTIVE',
              tiebreakerValue: null,
              totalScore: 0,
              standingsPosition: null,
              isEliminated: false,
              createdAt: new Date('2026-01-01'),
              updatedAt: new Date('2026-01-01'),
              squad: { id: 'squad-1', name: "Derek's Squad" },
            },
          ]),
          findUnique: jest.fn().mockResolvedValue({
            id: 'entry-2',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 2,
            name: "Derek's Squad Entry 2",
            status: 'ACTIVE',
            tiebreakerValue: null,
            totalScore: 0,
            standingsPosition: null,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
            squad: { id: 'squad-1', name: "Derek's Squad" },
          }),
        },
        contestConfiguration: {
          findUnique: jest.fn().mockResolvedValue({
            configMode: 'GOLF_TIERED',
            maxEntriesPerSquad: null,
          }),
        },
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockSquadRepo(),
        squadMembershipRepo,
        entryRepo,
        prisma as any,
      );

      const result = await service.createEntry('contest-1', 'user-1');

      expect(result.entryNumber).toBe(2);
      expect(entryRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        contestId: 'contest-1',
        squadId: 'squad-1',
        entryNumber: 2,
        name: "Derek's Squad Entry 2",
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
        contestEntryPick: { count: jest.fn().mockResolvedValue(1) },
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

    it('renames a team-owned contest entry while the contest is still open', async () => {
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
          {
            id: 'entry-2',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 2,
            name: "Derek's Squad Entry 2",
            status: 'ACTIVE',
            totalScore: 0,
            standingsPosition: undefined,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
        update: jest.fn().mockImplementation(async (id, updates) => ({
          id,
          contestId: 'contest-1',
          squadId: 'squad-1',
          entryNumber: id === 'entry-1' ? 1 : 2,
          name: updates.name ?? "Derek's Squad Entry 1",
          status: 'ACTIVE',
          totalScore: 0,
          standingsPosition: undefined,
          isEliminated: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
        })),
      });
      const prisma = createMockPrisma({
        contestEntry: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'entry-1',
              contestId: 'contest-1',
              squadId: 'squad-1',
              entryNumber: 1,
              name: 'Renamed Entry',
              status: 'ACTIVE',
              tiebreakerValue: null,
              totalScore: 0,
              standingsPosition: null,
              isEliminated: false,
              createdAt: new Date('2026-01-01'),
              updatedAt: new Date('2026-01-02'),
              squad: { id: 'squad-1', name: "Derek's Squad" },
            },
          ]),
          findUnique: jest.fn().mockResolvedValue({
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: 'Renamed Entry',
            status: 'ACTIVE',
            tiebreakerValue: null,
            totalScore: 0,
            standingsPosition: null,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-02'),
            squad: { id: 'squad-1', name: "Derek's Squad" },
          }),
        },
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

      const result = await service.updateEntry('contest-1', 'entry-1', 'user-1', {
        name: '  Renamed Entry  ',
      });

      expect(entryRepo.update).toHaveBeenCalledWith('entry-1', { name: 'Renamed Entry' });
      expect(result.name).toBe('Renamed Entry');
    });

    it('rejects renaming a contest entry to a duplicate team entry name', async () => {
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
            tiebreakerValue: null,
            totalScore: 0,
            standingsPosition: undefined,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
          {
            id: 'entry-2',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 2,
            name: 'Second Bullet',
            status: 'ACTIVE',
            tiebreakerValue: null,
            totalScore: 0,
            standingsPosition: undefined,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
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
        createMockPrisma() as any,
      );

      await expect(service.updateEntry('contest-1', 'entry-1', 'user-1', {
        name: ' second bullet ',
      })).rejects.toMatchObject({
        code: 'CONTEST_ENTRY_NAME_DUPLICATE',
      });
      expect(entryRepo.update).not.toHaveBeenCalled();
    });

    it('rejects renaming a contest entry after the contest locks', async () => {
      const contest = buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.LOCKED });
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

      await expect(service.updateEntry('contest-1', 'entry-1', 'user-1', {
        name: 'Renamed Entry',
      })).rejects.toMatchObject({
        code: 'CONTEST_ENTRY_LOCKED',
      });
    });

    it('updates the contest-entry tiebreaker prediction without renaming the entry', async () => {
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
            tiebreakerValue: null,
            totalScore: 0,
            standingsPosition: undefined,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      });
      const prisma = createMockPrisma({
        contestEntry: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'entry-1',
              contestId: 'contest-1',
              squadId: 'squad-1',
              entryNumber: 1,
              name: "Derek's Squad Entry 1",
              status: 'ACTIVE',
              tiebreakerValue: 271,
              totalScore: 0,
              standingsPosition: null,
              isEliminated: false,
              createdAt: new Date('2026-01-01'),
              updatedAt: new Date('2026-01-02'),
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
            tiebreakerValue: 271,
            totalScore: 0,
            standingsPosition: null,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-02'),
            squad: { id: 'squad-1', name: "Derek's Squad" },
          }),
        },
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

      const result = await service.updateEntry('contest-1', 'entry-1', 'user-1', {
        tiebreakerValue: 271,
      });

      expect(entryRepo.update).toHaveBeenCalledWith('entry-1', { tiebreakerValue: 271 });
      expect(result.tiebreakerValue).toBe(271);
    });

    it('pool-master-95b sends confirmation email after a completed entry is saved', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const entryRepo = createMockEntryRepo({
        findBySquad: jest.fn().mockResolvedValue([
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            entryNumber: 1,
            name: "Derek's Squad Entry 1",
            status: 'ACTIVE',
            tiebreakerValue: null,
            totalScore: 0,
            standingsPosition: undefined,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      });
      const contestEntryFindUnique = jest.fn()
        .mockResolvedValueOnce({
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          entryNumber: 1,
          name: "Derek's Squad Entry 1",
          status: 'ACTIVE',
          tiebreakerValue: 271,
          totalScore: 0,
          standingsPosition: null,
          isEliminated: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
          squad: { id: 'squad-1', name: "Derek's Squad" },
        })
        .mockResolvedValueOnce({
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          entryNumber: 1,
          name: "Derek's Squad Entry 1",
          status: 'ACTIVE',
          tiebreakerValue: 271,
          updatedAt: new Date('2026-01-02T12:00:00.000Z'),
          squad: { name: "Derek's Squad" },
          contest: {
            id: 'contest-1',
            leagueId: 'league-1',
            name: 'Masters Pick 2',
            configuration: {
              tierConfig: [
                {
                  tierId: 'tier-a',
                  tierName: 'Tier A',
                  tierNumber: 1,
                  picksFromTier: 1,
                  participantIds: ['participant-1'],
                },
                {
                  tierId: 'tier-b',
                  tierName: 'Tier B',
                  tierNumber: 2,
                  picksFromTier: 1,
                  participantIds: ['participant-2'],
                },
              ],
              rosterSize: 2,
              pickCount: null,
              rounds: null,
            },
            league: {
              name: 'Mathworks',
              leagueCode: 'MATHWORKS',
            },
          },
          picks: [
            {
              pickedAt: new Date('2026-01-01T12:00:00.000Z'),
              sportEventParticipant: {
                id: 'sport-event-participant-1',
                participant: { id: 'participant-1', name: 'Rory McIlroy' },
                valuations: [{ tier: 'Tier A', orderIndex: 1 }],
              },
            },
            {
              pickedAt: new Date('2026-01-01T12:01:00.000Z'),
              sportEventParticipant: {
                id: 'sport-event-participant-2',
                participant: { id: 'participant-2', name: 'Tommy Fleetwood' },
                valuations: [{ tier: 'Tier B', orderIndex: 1 }],
              },
            },
          ],
        });
      const prisma = createMockPrisma({
        contestEntry: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: contestEntryFindUnique,
        },
        contestEntryPick: {
          count: jest.fn().mockResolvedValue(2),
          groupBy: jest.fn().mockResolvedValue([]),
          findMany: jest.fn().mockResolvedValue([]),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            username: 'derek',
          }),
        },
      });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: jest.fn().mockResolvedValue({ provider: 'smtp' as const, messageId: 'mail-1' }),
      };
      const service = new ContestService(
        createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        createMockContestConfigurationRepo(),
        createMockMembershipRepo({ findByLeagueAndUser: jest.fn().mockResolvedValue(membership) }),
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
        undefined,
        mailDelivery,
        'https://app.primetimecommissioner.com',
      );

      await service.updateEntry('contest-1', 'entry-1', 'user-1', {
        tiebreakerValue: 271,
      });

      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
      expect(mailDelivery.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'derek@example.com',
        subject: 'Entry submitted: Masters Pick 2',
        metadata: {
          templateKey: 'CONTEST_ENTRY_COMPLETED',
          leagueId: 'league-1',
          contestId: 'contest-1',
          entryId: 'entry-1',
        },
      }));
      const sentMessage = mailDelivery.send.mock.calls[0][0];
      expect(sentMessage.text).toContain('Tier A: Rory McIlroy');
      expect(sentMessage.text).toContain('Tier B: Tommy Fleetwood');
      expect(sentMessage.text).toContain('Tiebreaker: +271');
      expect(sentMessage.text).toContain(
        'Review entry: https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1/entries/entry-1',
      );
      expect(sentMessage.html).toContain('Prime Time Commissioner');
    });

    it('pool-master-95b skips confirmation email until roster and tiebreaker are complete', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestEntryFindUnique = jest.fn()
        .mockResolvedValueOnce({
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          entryNumber: 1,
          name: "Derek's Squad Entry 1",
          status: 'ACTIVE',
          tiebreakerValue: 271,
          totalScore: 0,
          standingsPosition: null,
          isEliminated: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
          squad: { id: 'squad-1', name: "Derek's Squad" },
        })
        .mockResolvedValueOnce({
          id: 'entry-1',
          contestId: 'contest-1',
          name: "Derek's Squad Entry 1",
          tiebreakerValue: 271,
          updatedAt: new Date('2026-01-02T12:00:00.000Z'),
          squad: { name: "Derek's Squad" },
          contest: {
            id: 'contest-1',
            leagueId: 'league-1',
            name: 'Masters Pick 2',
            configuration: {
              tierConfig: [
                { tierName: 'Tier A', tierNumber: 1, picksFromTier: 1, participantIds: ['participant-1'] },
                { tierName: 'Tier B', tierNumber: 2, picksFromTier: 1, participantIds: ['participant-2'] },
              ],
              rosterSize: 2,
              pickCount: null,
              rounds: null,
            },
            league: { name: 'Mathworks', leagueCode: 'MATHWORKS' },
          },
          picks: [
            {
              pickedAt: new Date('2026-01-01T12:00:00.000Z'),
              sportEventParticipant: {
                id: 'sport-event-participant-1',
                participant: { id: 'participant-1', name: 'Rory McIlroy' },
                valuations: [{ tier: 'Tier A', orderIndex: 1 }],
              },
            },
          ],
        });
      const mailDelivery = {
        providerName: 'smtp' as const,
        send: jest.fn(),
      };
      const service = new ContestService(
        createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        createMockContestConfigurationRepo(),
        createMockMembershipRepo({ findByLeagueAndUser: jest.fn().mockResolvedValue(membership) }),
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
        createMockEntryRepo({
          findBySquad: jest.fn().mockResolvedValue([
            {
              id: 'entry-1',
              contestId: 'contest-1',
              squadId: 'squad-1',
              entryNumber: 1,
              name: "Derek's Squad Entry 1",
              status: 'ACTIVE',
              tiebreakerValue: null,
              totalScore: 0,
              standingsPosition: undefined,
              isEliminated: false,
              createdAt: new Date('2026-01-01'),
              updatedAt: new Date('2026-01-01'),
            },
          ]),
        }),
        createMockPrisma({
          contestEntry: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: contestEntryFindUnique,
          },
          contestEntryPick: {
            count: jest.fn().mockResolvedValue(1),
            groupBy: jest.fn().mockResolvedValue([]),
            findMany: jest.fn().mockResolvedValue([]),
          },
        }) as any,
        undefined,
        mailDelivery,
      );

      await service.updateEntry('contest-1', 'entry-1', 'user-1', {
        tiebreakerValue: 271,
      });

      expect(mailDelivery.send).not.toHaveBeenCalled();
    });

    it('pool-master-95b keeps the saved entry when confirmation email delivery fails', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        status: ContestStatus.OPEN,
      });
      const membership = buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' });
      const contestEntryFindUnique = jest.fn()
        .mockResolvedValueOnce({
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          entryNumber: 1,
          name: "Derek's Squad Entry 1",
          status: 'ACTIVE',
          tiebreakerValue: 271,
          totalScore: 0,
          standingsPosition: null,
          isEliminated: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
          squad: { id: 'squad-1', name: "Derek's Squad" },
        })
        .mockResolvedValueOnce({
          id: 'entry-1',
          contestId: 'contest-1',
          name: "Derek's Squad Entry 1",
          tiebreakerValue: -12,
          updatedAt: new Date('2026-01-02T12:00:00.000Z'),
          squad: { name: "Derek's Squad" },
          contest: {
            id: 'contest-1',
            leagueId: 'league-1',
            name: 'Masters Pick 1',
            configuration: {
              tierConfig: [{ tierName: 'Tier A', tierNumber: 1, picksFromTier: 1, participantIds: ['participant-1'] }],
              rosterSize: 1,
              pickCount: null,
              rounds: null,
            },
            league: { name: 'Mathworks', leagueCode: 'MATHWORKS' },
          },
          picks: [
            {
              pickedAt: new Date('2026-01-01T12:00:00.000Z'),
              sportEventParticipant: {
                id: 'sport-event-participant-1',
                participant: { id: 'participant-1', name: 'Rory McIlroy' },
                valuations: [{ tier: 'Tier A', orderIndex: 1 }],
              },
            },
          ],
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
            tiebreakerValue: null,
            totalScore: 0,
            standingsPosition: undefined,
            isEliminated: false,
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ]),
      });
      const mailDelivery = {
        providerName: 'ses' as const,
        send: jest.fn().mockRejectedValue(new Error('SES rejected request')),
      };
      const service = new ContestService(
        createMockContestRepo({ findById: jest.fn().mockResolvedValue(contest) }),
        createMockContestConfigurationRepo(),
        createMockMembershipRepo({ findByLeagueAndUser: jest.fn().mockResolvedValue(membership) }),
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
        createMockPrisma({
          contestEntry: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: contestEntryFindUnique,
          },
          contestEntryPick: {
            count: jest.fn().mockResolvedValue(1),
            groupBy: jest.fn().mockResolvedValue([]),
            findMany: jest.fn().mockResolvedValue([]),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue({
              email: 'derek@example.com',
              firstName: 'Derek',
              lastName: 'Dorazio',
              username: 'derek',
            }),
          },
        }) as any,
        undefined,
        mailDelivery,
      );

      await expect(service.updateEntry('contest-1', 'entry-1', 'user-1', {
        tiebreakerValue: -12,
      })).resolves.toEqual(expect.objectContaining({ id: 'entry-1' }));
      expect(entryRepo.update).toHaveBeenCalledWith('entry-1', { tiebreakerValue: -12 });
      expect(mailDelivery.send).toHaveBeenCalledTimes(1);
    });
  });
});
