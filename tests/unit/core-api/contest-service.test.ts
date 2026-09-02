import * as SharedDomainEnums from '@poolmaster/shared/domain/enums';
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

function buildGolfLeaderboardParticipantRow(input: {
  id: string;
  participantName: string;
  eventScoreToPar: number;
  eventStrokes: number;
  status: string;
  currentRound?: number;
  currentRoundThru?: number;
  rounds?: Array<{
    round: number;
    strokes: number;
    scoreToPar: number;
    thru: number | null;
    status: string;
  }>;
}) {
  return {
    id: input.id,
    participantId: `participant-${input.id}`,
    status: 'active',
    worldRanking: null,
    oddsToWin: null,
    seedNumber: null,
    participant: {
      id: `participant-${input.id}`,
      name: input.participantName,
      shortName: null,
    },
    golfStanding: {
      eventScoreToPar: input.eventScoreToPar,
      eventStrokes: input.eventStrokes,
      currentRound: input.currentRound ?? 2,
      currentRoundThru: input.currentRoundThru ?? 18,
      status: input.status,
      position: null,
      displayPosition: null,
      asOf: new Date('2026-05-31T18:00:00.000Z'),
    },
    golfRounds: (input.rounds ?? []).map((round) => ({
      strokes: round.strokes,
      scoreToPar: round.scoreToPar,
      thru: round.thru,
      status: round.status,
      sportEventRound: { roundNumber: round.round },
    })),
  };
}

function buildGolfLeaderboardPick(id: string, sportEventParticipantId: string) {
  return {
    id,
    sportEventParticipantId,
    pickedAt: new Date(`2026-05-30T12:00:0${id.slice(-1)}.000Z`),
    slot: null,
    tier: null,
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

    it('pool-master-eux.4: computes the Golf leaderboard from event standings instead of ContestEntry totals', async () => {
      const contest = buildContest({
        id: 'contest-1',
        leagueId: 'league-1',
        sportEventId: 'event-1',
        status: ContestStatus.ACTIVE,
      });
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(contest),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(
          buildMembership({ id: 'membership-1', leagueId: 'league-1', userId: 'user-1' }),
        ),
      });
      const contestFindUnique = jest.fn().mockResolvedValue({
        id: 'contest-1',
        sportEvent: {
          id: 'event-1',
          sport: Sport.GOLF,
        },
        contestSportEvents: [],
        configuration: {
          configJson: {
            mode: 'GOLF_TIERED',
            countedScores: 2,
          },
          rosterSize: 3,
          pickCount: 3,
          rounds: 4,
        },
      });
      const participantFindMany = jest.fn().mockResolvedValue([
        buildGolfLeaderboardParticipantRow({
          id: 'sep-1',
          participantName: 'Rory McIlroy',
          eventScoreToPar: -5,
          eventStrokes: 139,
          status: 'IN_PROGRESS',
          currentRound: 2,
          currentRoundThru: 9,
          rounds: [
            { round: 1, strokes: 69, scoreToPar: -3, thru: null, status: 'COMPLETED' },
            { round: 2, strokes: 47, scoreToPar: -2, thru: 9, status: 'IN_PROGRESS' },
          ],
        }),
        buildGolfLeaderboardParticipantRow({
          id: 'sep-2',
          participantName: 'Scottie Scheffler',
          eventScoreToPar: -2,
          eventStrokes: 142,
          status: 'COMPLETE',
          currentRound: 2,
          currentRoundThru: 18,
        }),
        buildGolfLeaderboardParticipantRow({
          id: 'sep-3',
          participantName: 'Jordan Spieth',
          eventScoreToPar: 1,
          eventStrokes: 145,
          status: 'COMPLETE',
        }),
        buildGolfLeaderboardParticipantRow({
          id: 'sep-4',
          participantName: 'Ludvig Aberg',
          eventScoreToPar: -7,
          eventStrokes: 137,
          status: 'COMPLETE',
        }),
      ]);
      const contestEntryFindMany = jest.fn().mockResolvedValue([
        {
          id: 'entry-1',
          entryNumber: 1,
          name: 'Legacy Inflated Entry',
          status: 'ACTIVE',
          squadId: 'squad-1',
          squad: { name: 'Ryans Gonna Win' },
          picks: [
            buildGolfLeaderboardPick('pick-1', 'sep-1'),
            buildGolfLeaderboardPick('pick-2', 'sep-2'),
            buildGolfLeaderboardPick('pick-3', 'sep-3'),
          ],
        },
        {
          id: 'entry-2',
          entryNumber: 2,
          name: 'Live Standing Entry',
          status: 'ACTIVE',
          squadId: 'squad-2',
          squad: { name: 'Lets Go Cam!' },
          picks: [
            buildGolfLeaderboardPick('pick-4', 'sep-4'),
            buildGolfLeaderboardPick('pick-5', 'sep-2'),
            buildGolfLeaderboardPick('pick-6', 'sep-3'),
          ],
        },
      ]);
      const prisma = createMockPrisma({
        contest: { findUnique: contestFindUnique },
        sportEventParticipant: { findMany: participantFindMany },
        contestEntry: { findMany: contestEntryFindMany },
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockSquadRepo(),
        createMockSquadMembershipRepo(),
        createMockEntryRepo(),
        prisma as any,
      );

      const result = await service.getGolfLeaderboard('contest-1', 'user-1');

      expect(result.countingRule).toEqual({ type: 'BEST_N_GOLFERS', count: 2 });
      expect(result.entries.map((entry) => [entry.entryId, entry.totalScoreToPar, entry.position])).toEqual([
        ['entry-2', -9, 1],
        ['entry-1', -7, 2],
      ]);
      expect(result.entries[0].picks.map((pick) => ({
        pickId: pick.pickId,
        isCounting: pick.isCounting,
        isDropped: pick.isDropped,
      }))).toEqual([
        { pickId: 'pick-4', isCounting: true, isDropped: false },
        { pickId: 'pick-5', isCounting: true, isDropped: false },
        { pickId: 'pick-6', isCounting: false, isDropped: true },
      ]);
      const rory = result.participants.find((participant) => participant.sportEventParticipantId === 'sep-1');
      expect(rory?.totalScoreToPar).toBe(-5);
      expect(rory?.thru).toBe(9);
      expect(rory?.rounds.r1).toEqual(expect.objectContaining({
        displayType: 'STROKES',
        displayValue: '69',
      }));
      expect(rory?.rounds.r2).toEqual(expect.objectContaining({
        displayType: 'TO_PAR',
        displayValue: '-2',
        thru: 9,
      }));
      expect(contestEntryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { entryNumber: 'asc' },
            { createdAt: 'asc' },
          ],
        }),
      );
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

    it('pool-master-piv falls back to golf-tier-service for the email tier grouping when the contest has no typed tierConfig', async () => {
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
            sportEventId: 'event-1',
            configuration: {
              tierConfig: null,
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
              },
            },
            {
              pickedAt: new Date('2026-01-01T12:01:00.000Z'),
              sportEventParticipant: {
                id: 'sport-event-participant-2',
                participant: { id: 'participant-2', name: 'Tommy Fleetwood' },
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
        sportEventGolfTier: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'tier-a',
              sportEventId: 'event-1',
              tierKey: 'A',
              label: 'Tier A',
              tierNumber: 1,
              defaultPickCount: 1,
              valuations: [
                {
                  sportEventParticipantId: 'sport-event-participant-1',
                  tierOrderIndex: 1,
                  price: null,
                  sportEventParticipant: { participantId: 'participant-1' },
                },
              ],
            },
            {
              id: 'tier-b',
              sportEventId: 'event-1',
              tierKey: 'B',
              label: 'Tier B',
              tierNumber: 2,
              defaultPickCount: 1,
              valuations: [
                {
                  sportEventParticipantId: 'sport-event-participant-2',
                  tierOrderIndex: 1,
                  price: null,
                  sportEventParticipant: { participantId: 'participant-2' },
                },
              ],
            },
          ]),
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

      const sentMessage = mailDelivery.send.mock.calls[0][0];
      expect(sentMessage.text).toContain('Tier A: Rory McIlroy');
      expect(sentMessage.text).toContain('Tier B: Tommy Fleetwood');
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

  describe('getEntryDetail', () => {
    // pool-master-uvc — proves this call site delegates to the shared
    // deriveLegacyParticipantStatus derivation rather than a second copy of the
    // same ternary; the derivation's own branches are covered directly in
    // tests/unit/shared/domain-models.test.ts.
    it('derives participantStatus via the shared deriveLegacyParticipantStatus function', async () => {
      const deriveSpy = jest.spyOn(SharedDomainEnums, 'deriveLegacyParticipantStatus');

      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ id: 'contest-1', leagueId: 'league-1' })),
      });
      const membershipRepo = createMockMembershipRepo({
        findByLeagueAndUser: jest.fn().mockResolvedValue(buildMembership()),
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
      const contestEntryFindFirst = jest.fn().mockResolvedValue({
        id: 'entry-1',
        contestId: 'contest-1',
        squadId: 'squad-1',
        entryNumber: 1,
        name: 'Withdrawn Golfer Entry',
        status: 'ACTIVE',
        tiebreakerValue: null,
        isEliminated: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        squad: { name: "Derek's Squad" },
        picks: [
          {
            id: 'pick-1',
            sportEventParticipantId: 'sep-1',
            pickedAt: new Date('2026-05-01'),
            sportEventParticipant: {
              participantId: 'participant-1',
              isActive: false,
              inactiveReason: 'WITHDRAWN',
              participant: { name: 'Withdrawn Golfer', position: null, teamAffiliation: null },
            },
          },
        ],
      });
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        membershipRepo,
        createMockLeagueRepo(),
        createMockSquadRepo(),
        squadMembershipRepo,
        createMockEntryRepo(),
        createMockPrisma({
          contestEntry: { findFirst: contestEntryFindFirst },
        }) as any,
      );

      const { entry } = await service.getEntryDetail('contest-1', 'entry-1', 'user-1');

      expect(deriveSpy).toHaveBeenCalledWith(false, 'WITHDRAWN');
      deriveSpy.mockRestore();
      expect(entry.participants).toEqual([
        expect.objectContaining({ participantName: 'Withdrawn Golfer', participantStatus: 'WITHDRAWN' }),
      ]);
    });
  });

  describe('listEntries', () => {
    // pool-master-uvc — same shared-function proof as getEntryDetail above, for
    // the other contests/service.ts call site (loadParticipantsForEntries).
    it('derives participantStatus via the shared deriveLegacyParticipantStatus function', async () => {
      const deriveSpy = jest.spyOn(SharedDomainEnums, 'deriveLegacyParticipantStatus');

      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(
          buildContest({ id: 'contest-1', leagueId: 'league-1', status: ContestStatus.ACTIVE }),
        ),
      });
      const contestEntryFindMany = jest.fn().mockResolvedValue([
        {
          id: 'entry-1',
          contestId: 'contest-1',
          squadId: 'squad-1',
          entryNumber: 1,
          name: 'Cut Golfer Entry',
          status: 'ACTIVE',
          tiebreakerValue: null,
          isEliminated: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
          squad: { name: "Derek's Squad" },
        },
      ]);
      const contestEntryPickFindMany = jest.fn().mockResolvedValue([
        {
          id: 'pick-1',
          entryId: 'entry-1',
          sportEventParticipantId: 'sep-1',
          pickedAt: new Date('2026-05-01'),
          sportEventParticipant: {
            participantId: 'participant-1',
            isActive: false,
            inactiveReason: 'CUT',
            participant: { name: 'Cut Golfer', position: null, teamAffiliation: null },
          },
        },
      ]);
      const service = new ContestService(
        contestRepo,
        createMockContestConfigurationRepo(),
        createMockMembershipRepo(),
        createMockLeagueRepo(),
        createMockSquadRepo(),
        createMockSquadMembershipRepo(),
        createMockEntryRepo(),
        createMockPrisma({
          contestEntry: { findMany: contestEntryFindMany },
          contestEntryPick: {
            count: jest.fn().mockResolvedValue(0),
            groupBy: jest.fn().mockResolvedValue([{ entryId: 'entry-1', _count: { id: 1 } }]),
            findMany: contestEntryPickFindMany,
          },
        }) as any,
      );

      const { entries } = await service.listEntries('contest-1', 'user-1');

      expect(deriveSpy).toHaveBeenCalledWith(false, 'CUT');
      deriveSpy.mockRestore();
      expect(entries[0].participants).toEqual([
        expect.objectContaining({ participantName: 'Cut Golfer', participantStatus: 'CUT' }),
      ]);
    });
  });
});
