import { OverrideService, OverrideError } from '../../../packages/core-api/src/modules/contests/override-service';
import type { ContestRepository } from '@poolmaster/shared/db';
import { ContestStatus } from '@poolmaster/shared/domain';
import { buildContest } from '../../factories';
import { fakeContestRepo } from '../../support/repo-fakes';

function createMockContestRepo(overrides: Partial<ContestRepository> = {}): ContestRepository {
  return fakeContestRepo({
    findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.ACTIVE })),
    create: jest.fn().mockResolvedValue(buildContest()),
    update: jest.fn().mockImplementation(async (id, updates) => ({ ...buildContest({ id }), ...updates })),
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
      await service.reopenContest('contest-1', 'Scoring error found');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.ACTIVE });
    });

    it('throws when contest is not completed', async () => {
      const service = new OverrideService(createMockContestRepo());
      await expect(service.reopenContest('contest-1', 'reason')).rejects.toThrow('completed');
    });
  });

  describe('closeContest', () => {
    it('force-closes an active contest', async () => {
      const contestRepo = createMockContestRepo();
      const service = new OverrideService(contestRepo);
      await service.closeContest('contest-1', 'Season over');
      expect(contestRepo.update).toHaveBeenCalledWith('contest-1', { status: ContestStatus.COMPLETED });
    });

    it('throws when contest is already completed', async () => {
      const contestRepo = createMockContestRepo({
        findById: jest.fn().mockResolvedValue(buildContest({ status: ContestStatus.COMPLETED })),
      });
      const service = new OverrideService(contestRepo);
      await expect(service.closeContest('contest-1', 'reason')).rejects.toThrow('already closed');
    });
  });

});
