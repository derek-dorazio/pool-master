import { OverrideService, OverrideError } from '../../../packages/core-api/src/modules/contests/override-service';
import type {
  ContestRepository,
  DraftSessionRepository,
} from '@poolmaster/shared/db';
import { ContestStatus, DraftStatus } from '@poolmaster/shared/domain';
import { buildContest } from '../../factories';

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

describe('OverrideService', () => {
  describe('pauseDraft', () => {
    it('pauses a live draft', async () => {
      const draftRepo = createMockDraftSessionRepo();
      const service = new OverrideService(
        createMockContestRepo(),
        draftRepo,
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
        createMockContestRepo(), draftRepo,
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
        createMockContestRepo(), draftRepo,
      );
      await service.resumeDraft('contest-1');
      expect(draftRepo.update).toHaveBeenCalledWith('session-1', { status: DraftStatus.LIVE });
    });
  });

  describe('extendPickClock', () => {
    it('shifts the current turn start time', async () => {
      const draftRepo = createMockDraftSessionRepo();
      const service = new OverrideService(
        createMockContestRepo(), draftRepo,
      );
      await service.extendPickClock('contest-1', 30);
      expect(draftRepo.update).toHaveBeenCalled();
      const updateArg = (draftRepo.update as jest.Mock).mock.calls[0][1];
      expect(updateArg.currentTurnStartedAt).toBeDefined();
    });
  });

  describe('reopenContest', () => {
    it('reopens a completed contest', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(),
      );
      await service.reopenContest('contest-1', 'Scoring error found');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.ACTIVE });
    });

    it('throws when contest is not completed', async () => {
      const service = new OverrideService(
        createMockContestRepo(), createMockDraftSessionRepo(),
      );
      await expect(service.reopenContest('contest-1', 'reason')).rejects.toThrow('completed');
    });
  });

  describe('closeContest', () => {
    it('force-closes an active contest', async () => {
      const contestRepo = createMockContestRepo();
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(),
      );
      await service.closeContest('contest-1', 'Season over');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.COMPLETED });
    });

    it('throws when contest is already completed', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(),
      );
      await expect(service.closeContest('contest-1', 'reason')).rejects.toThrow('already closed');
    });
  });

});
