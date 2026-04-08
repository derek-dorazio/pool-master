import { OverrideService, OverrideError } from '../../../packages/core-api/src/modules/contests/override-service';
import type {
  ContestRepository,
  ContestEntryRepository,
  DraftSessionRepository,
} from '@poolmaster/shared/db';
import { ContestStatus, DraftStatus } from '@poolmaster/shared/domain';
import { buildContest } from '../../factories';
import type { ContestScoringRecalculationService } from '../../../packages/core-api/src/modules/contest-scoring';

function createMockContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return {
    findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.ACTIVE })),
    findByLeague: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(buildContest()),
    update: jest.fn().mockImplementation(async (id, updates) => ({ ...buildContest({ id }), ...updates })),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockDraftSessionRepo(overrides: Partial<DraftSessionRepository> = {}): DraftSessionRepository {
  return {
    findById: jest.fn().mockResolvedValue(null),
    findByContest: jest.fn().mockResolvedValue({
      id: 'session-1',
      contestId: 'contest-1',
      status: DraftStatus.LIVE,
      currentPickNumber: 5,
      currentTurnStartedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockImplementation(async (id, updates) => ({ id, ...updates })),
    getPickHistories: jest.fn().mockResolvedValue([]),
    addPickHistory: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function createMockEntryRepo(overrides: Partial<ContestEntryRepository> = {}): ContestEntryRepository {
  return {
    findById: jest.fn().mockResolvedValue({
      id: 'entry-1',
      contestId: 'contest-1',
      squadId: 'squad-1',
      entryNumber: 1,
      name: 'Team Alpha',
      status: 'ACTIVE',
      totalScore: 100,
      standingsPosition: 2,
      isEliminated: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    findByContest: jest.fn().mockResolvedValue([
      {
        id: 'entry-1',
        contestId: 'contest-1',
        squadId: 'squad-1',
        entryNumber: 1,
        name: 'Team A',
        status: 'ACTIVE',
        totalScore: 150,
        standingsPosition: 2,
        isEliminated: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'entry-2',
        contestId: 'contest-1',
        squadId: 'squad-2',
        entryNumber: 1,
        name: 'Team B',
        status: 'ACTIVE',
        totalScore: 120,
        standingsPosition: 1,
        isEliminated: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    findBySquad: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({} as any),
    update: jest.fn().mockResolvedValue({} as any),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockContestScoringRecalculationService(
  overrides: Partial<ContestScoringRecalculationService> = {},
): ContestScoringRecalculationService {
  return {
    recalculateContest: jest.fn().mockResolvedValue({
      contestId: 'contest-1',
      teamsAffected: 2,
      standingsChanged: true,
      changes: [
        {
          entryId: 'entry-1',
          oldRank: 2,
          newRank: 1,
          oldScore: 150,
          newScore: 150,
        },
        {
          entryId: 'entry-2',
          oldRank: 1,
          newRank: 2,
          oldScore: 120,
          newScore: 120,
        },
      ],
    }),
    ...overrides,
  } as ContestScoringRecalculationService;
}

describe('OverrideService', () => {
  describe('pauseDraft', () => {
    it('pauses a live draft', async () => {
      const draftRepo = createMockDraftSessionRepo();
      const service = new OverrideService(
        createMockContestRepo(),
        draftRepo,
        createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await service.pauseDraft('contest-1', 'Technical issue');
      expect(draftRepo.update).toHaveBeenCalledWith('session-1', { status: DraftStatus.PAUSED });
    });

    it('throws when draft is not live', async () => {
      const draftRepo = createMockDraftSessionRepo({
        findByContest: jest.fn().mockResolvedValue({
          id: 'session-1', status: DraftStatus.PAUSED, currentPickNumber: 5,
          createdAt: new Date(), updatedAt: new Date(),
        }),
      });
      const service = new OverrideService(
        createMockContestRepo(), draftRepo, createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await expect(service.pauseDraft('contest-1', 'reason')).rejects.toThrow(OverrideError);
    });
  });

  describe('resumeDraft', () => {
    it('resumes a paused draft', async () => {
      const draftRepo = createMockDraftSessionRepo({
        findByContest: jest.fn().mockResolvedValue({
          id: 'session-1', status: DraftStatus.PAUSED, currentPickNumber: 5,
          createdAt: new Date(), updatedAt: new Date(),
        }),
      });
      const service = new OverrideService(
        createMockContestRepo(), draftRepo, createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await service.resumeDraft('contest-1');
      expect(draftRepo.update).toHaveBeenCalledWith('session-1', { status: DraftStatus.LIVE });
    });
  });

  describe('extendPickClock', () => {
    it('shifts the current turn start time', async () => {
      const draftRepo = createMockDraftSessionRepo();
      const service = new OverrideService(
        createMockContestRepo(), draftRepo, createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await service.extendPickClock('contest-1', 30);
      expect(draftRepo.update).toHaveBeenCalled();
      const updateArg = (draftRepo.update as jest.Mock).mock.calls[0][1];
      expect(updateArg.currentTurnStartedAt).toBeDefined();
    });
  });

  describe('adjustScore', () => {
    it('adjusts entry score by delta', async () => {
      const entryRepo = createMockEntryRepo();
      const service = new OverrideService(
        createMockContestRepo(), createMockDraftSessionRepo(), entryRepo,
        createMockContestScoringRecalculationService(),
      );
      await service.adjustScore('contest-1', 'entry-1', -10, 'Scoring error');
      expect(entryRepo.update).toHaveBeenCalledWith('entry-1', { totalScore: 90 });
    });

    it('throws when entry not in contest', async () => {
      const entryRepo = createMockEntryRepo({
        findById: jest.fn().mockResolvedValue({ id: 'entry-1', contestId: 'other-contest', totalScore: 50, createdAt: new Date(), updatedAt: new Date() }),
      });
      const service = new OverrideService(
        createMockContestRepo(), createMockDraftSessionRepo(), entryRepo,
        createMockContestScoringRecalculationService(),
      );
      await expect(service.adjustScore('contest-1', 'entry-1', 5, 'reason')).rejects.toThrow(OverrideError);
    });
  });

  describe('recalculateStandings', () => {
    it('recalculates standings from entry scores', async () => {
      const scoringRecalculationService = createMockContestScoringRecalculationService();
      const service = new OverrideService(
        createMockContestRepo(),
        createMockDraftSessionRepo(),
        createMockEntryRepo(),
        scoringRecalculationService,
      );
      const result = await service.recalculateStandings('contest-1', 'tenant-1');
      expect(result.contestId).toBe('contest-1');
      expect(result.teamsAffected).toBe(2);
      expect(scoringRecalculationService.recalculateContest).toHaveBeenCalledWith('contest-1');
    });
  });

  describe('reopenContest', () => {
    it('reopens a completed contest', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(), createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await service.reopenContest('contest-1', 'tenant-1', 'Scoring error found');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.ACTIVE });
    });

    it('throws when contest is not completed', async () => {
      const service = new OverrideService(
        createMockContestRepo(), createMockDraftSessionRepo(), createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await expect(service.reopenContest('contest-1', 'tenant-1', 'reason')).rejects.toThrow('completed');
    });
  });

  describe('closeContest', () => {
    it('force-closes an active contest', async () => {
      const contestRepo = createMockContestRepo();
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(), createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await service.closeContest('contest-1', 'tenant-1', 'Season over');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.COMPLETED });
    });

    it('throws when contest is already completed', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(), createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await expect(service.closeContest('contest-1', 'tenant-1', 'reason')).rejects.toThrow('already closed');
    });
  });

  describe('confirmPayouts', () => {
    it('confirms payouts for a completed contest', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(), createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await service.confirmPayouts('contest-1', 'tenant-1');
      expect(contestRepo.update).toHaveBeenCalled();
    });

    it('throws when contest is not completed', async () => {
      const service = new OverrideService(
        createMockContestRepo(), createMockDraftSessionRepo(), createMockEntryRepo(),
        createMockContestScoringRecalculationService(),
      );
      await expect(service.confirmPayouts('contest-1', 'tenant-1')).rejects.toThrow('completed');
    });
  });
});
