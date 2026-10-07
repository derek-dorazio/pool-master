import { OverrideService } from '../../../packages/core-api/src/modules/contests/override-service';
import type { ContestRepository } from '@poolmaster/shared/db';
import { ContestStatus } from '@poolmaster/shared/domain';
import { buildContest } from '../../factories';
import { fakeContestRepo } from '../../support/repo-fakes';
import { mockFn } from '../../support/mock-fn';
import { InMemoryContestWorld } from '../../support/in-memory-contest-world';

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


  describe('against stored contests', () => {
    function world(status: ContestStatus) {
      const contests = new InMemoryContestWorld();
      const contest = contests.addContest('league-1', { status, endsAt: new Date('2026-04-12T23:00:00Z') });
      return { contests, contest, service: new OverrideService(contests.contestRepo()) };
    }

    it.each([ContestStatus.OPEN, ContestStatus.LOCKED, ContestStatus.ACTIVE])(
      'stores COMPLETED when a %s contest is closed early',
      async (status) => {
        const { contests, contest, service } = world(status);

        await service.closeContest(contest.id);

        expect(contests.contests.get(contest.id)?.status).toBe(ContestStatus.COMPLETED);
      },
    );

    it('refuses to close a cancelled contest with CONTEST_ALREADY_CLOSED and keeps it cancelled', async () => {
      const { contests, contest, service } = world(ContestStatus.CANCELLED);

      await expect(service.closeContest(contest.id)).rejects.toMatchObject({ code: 'CONTEST_ALREADY_CLOSED' });
      expect(contests.contests.get(contest.id)?.status).toBe(ContestStatus.CANCELLED);
    });

    it('stores ACTIVE when a completed contest is reopened, and refuses reopening a cancelled one', async () => {
      const completed = world(ContestStatus.COMPLETED);
      await completed.service.reopenContest(completed.contest.id);
      expect(completed.contests.contests.get(completed.contest.id)?.status).toBe(ContestStatus.ACTIVE);

      const cancelled = world(ContestStatus.CANCELLED);
      await expect(cancelled.service.reopenContest(cancelled.contest.id))
        .rejects.toMatchObject({ code: 'CONTEST_REOPEN_STATUS_INVALID' });
    });

    it('stores the new end time when a deadline is extended', async () => {
      const { contests, contest, service } = world(ContestStatus.ACTIVE);
      const newEnd = new Date('2026-04-13T23:00:00Z');

      await service.extendDeadline(contest.id, newEnd);

      expect(contests.contests.get(contest.id)?.endsAt).toEqual(newEnd);
    });

    it('answers CONTEST_NOT_FOUND from every override for an unknown contest', async () => {
      const { service } = world(ContestStatus.ACTIVE);

      await expect(service.reopenContest('missing')).rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND' });
      await expect(service.closeContest('missing')).rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND' });
      await expect(service.extendDeadline('missing', new Date())).rejects.toMatchObject({ code: 'CONTEST_NOT_FOUND' });
    });
  });
});
