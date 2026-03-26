import { OverrideService, OverrideError } from '../../../packages/core-api/src/modules/contests/override-service';
import type {
  ContestRepository,
  ContestEntryRepository,
  ContestStandingRepository,
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
      pickDeadline: new Date(Date.now() + 60000),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockImplementation(async (id, updates) => ({ id, ...updates })),
    getPicks: jest.fn().mockResolvedValue([]),
    addPick: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function createMockEntryRepo(overrides: Partial<ContestEntryRepository> = {}): ContestEntryRepository {
  return {
    findById: jest.fn().mockResolvedValue({
      id: 'entry-1',
      contestId: 'contest-1',
      leagueMembershipId: 'member-1',
      name: 'Team Alpha',
      totalScore: 100,
      isEliminated: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    findByContest: jest.fn().mockResolvedValue([
      { id: 'entry-1', contestId: 'contest-1', name: 'Team A', totalScore: 150, createdAt: new Date(), updatedAt: new Date() },
      { id: 'entry-2', contestId: 'contest-1', name: 'Team B', totalScore: 120, createdAt: new Date(), updatedAt: new Date() },
    ]),
    findByMember: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function createMockStandingRepo(overrides: Partial<ContestStandingRepository> = {}): ContestStandingRepository {
  return {
    findByContest: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockImplementation(async (s) => ({ ...s, id: 'standing-1', createdAt: new Date(), updatedAt: new Date() })),
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
        createMockEntryRepo(),
        createMockStandingRepo(),
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
        createMockContestRepo(), draftRepo, createMockEntryRepo(), createMockStandingRepo(),
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
        createMockContestRepo(), draftRepo, createMockEntryRepo(), createMockStandingRepo(),
      );
      await service.resumeDraft('contest-1');
      expect(draftRepo.update).toHaveBeenCalledWith('session-1', { status: DraftStatus.LIVE });
    });
  });

  describe('extendPickClock', () => {
    it('adds seconds to the pick deadline', async () => {
      const draftRepo = createMockDraftSessionRepo();
      const service = new OverrideService(
        createMockContestRepo(), draftRepo, createMockEntryRepo(), createMockStandingRepo(),
      );
      await service.extendPickClock('contest-1', 30);
      expect(draftRepo.update).toHaveBeenCalled();
      const updateArg = (draftRepo.update as jest.Mock).mock.calls[0][1];
      expect(updateArg.pickDeadline).toBeDefined();
    });
  });

  describe('adjustScore', () => {
    it('adjusts entry score by delta', async () => {
      const entryRepo = createMockEntryRepo();
      const service = new OverrideService(
        createMockContestRepo(), createMockDraftSessionRepo(), entryRepo, createMockStandingRepo(),
      );
      await service.adjustScore('contest-1', 'entry-1', -10, 'Scoring error');
      expect(entryRepo.update).toHaveBeenCalledWith('entry-1', { totalScore: 90 });
    });

    it('throws when entry not in contest', async () => {
      const entryRepo = createMockEntryRepo({
        findById: jest.fn().mockResolvedValue({ id: 'entry-1', contestId: 'other-contest', totalScore: 50, createdAt: new Date(), updatedAt: new Date() }),
      });
      const service = new OverrideService(
        createMockContestRepo(), createMockDraftSessionRepo(), entryRepo, createMockStandingRepo(),
      );
      await expect(service.adjustScore('contest-1', 'entry-1', 5, 'reason')).rejects.toThrow(OverrideError);
    });
  });

  describe('recalculateStandings', () => {
    it('recalculates standings from entry scores', async () => {
      const service = new OverrideService(
        createMockContestRepo(),
        createMockDraftSessionRepo(),
        createMockEntryRepo(),
        createMockStandingRepo(),
      );
      const result = await service.recalculateStandings('contest-1', 'tenant-1');
      expect(result.contestId).toBe('contest-1');
      expect(result.teamsAffected).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reopenContest', () => {
    it('reopens a completed contest', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(), createMockEntryRepo(), createMockStandingRepo(),
      );
      await service.reopenContest('contest-1', 'tenant-1', 'Scoring error found');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.ACTIVE });
    });

    it('throws when contest is not completed', async () => {
      const service = new OverrideService(
        createMockContestRepo(), createMockDraftSessionRepo(), createMockEntryRepo(), createMockStandingRepo(),
      );
      await expect(service.reopenContest('contest-1', 'tenant-1', 'reason')).rejects.toThrow('completed');
    });
  });

  describe('closeContest', () => {
    it('force-closes an active contest', async () => {
      const contestRepo = createMockContestRepo();
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(), createMockEntryRepo(), createMockStandingRepo(),
      );
      await service.closeContest('contest-1', 'tenant-1', 'Season over');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.COMPLETED });
    });

    it('throws when contest is already completed', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(
        contestRepo, createMockDraftSessionRepo(), createMockEntryRepo(), createMockStandingRepo(),
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
        contestRepo, createMockDraftSessionRepo(), createMockEntryRepo(), createMockStandingRepo(),
      );
      await service.confirmPayouts('contest-1', 'tenant-1');
      expect(contestRepo.update).toHaveBeenCalled();
    });

    it('throws when contest is not completed', async () => {
      const service = new OverrideService(
        createMockContestRepo(), createMockDraftSessionRepo(), createMockEntryRepo(), createMockStandingRepo(),
      );
      await expect(service.confirmPayouts('contest-1', 'tenant-1')).rejects.toThrow('completed');
    });
  });
});
