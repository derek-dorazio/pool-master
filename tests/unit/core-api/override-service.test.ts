import { OverrideService } from '../../../packages/core-api/src/modules/contests/override-service';
import type { ContestRepository } from '@poolmaster/shared/db';
import { ContestStatus } from '@poolmaster/shared/domain';
import { buildContest } from '../../factories';
import { fakeContestRepo } from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';

function createMockContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return fakeContestRepo({
    findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.ACTIVE })),
    update: mockFn<ContestRepository['update']>(async (id, updates) => ({ ...buildContest({ id }), ...updates })),
    ...overrides,
  });
}

describe('OverrideService', () => {
  describe('reopenContest', () => {
    it('reopens a completed contest', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(contestRepo);
      await service.reopenContest('contest-1');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.ACTIVE });
    });

    it('throws when contest is not completed', async () => {
      const service = new OverrideService(createMockContestRepo());
      await expect(service.reopenContest('contest-1')).rejects.toThrow('completed');
    });
  });

  describe('closeContest', () => {
    it('force-closes an active contest', async () => {
      const contestRepo = createMockContestRepo();
      const service = new OverrideService(contestRepo);
      await service.closeContest('contest-1');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.COMPLETED });
    });

    it('throws when contest is already completed', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(contestRepo);
      await expect(service.closeContest('contest-1')).rejects.toThrow('already closed');
    });

    it('refuses to close a draft with 409 CONTEST_CLOSE_STATUS_INVALID and leaves it a draft, because a draft leaves only by being opened or deleted', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.DRAFT })),
      });
      const service = new OverrideService(contestRepo);
      await expect(service.closeContest('contest-1')).rejects.toMatchObject({
        code: 'CONTEST_CLOSE_STATUS_INVALID',
        statusCode: 409,
      });
      expect(contestRepo.update).not.toHaveBeenCalled();
    });
  });

});
