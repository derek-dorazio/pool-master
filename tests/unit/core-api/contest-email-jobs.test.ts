/**
 * The contest started and final results email jobs (#1387): each reads again what the request
 * that moved the contest no longer hands over, and asks the notices for the same emails.
 */
import { BackgroundJobType, ContestFormat, ContestStatus, type SportEvent } from '@poolmaster/shared/domain';
import {
  ContestEmailJobs,
  contestEventChangedEmailsJob,
  contestReopenedEmailsJob,
  contestSettledEmailsJob,
  contestStartedEmailsJob,
  type ContestEmailJobDeps,
} from '../../../packages/core-api/src/modules/notifications';
import { BackgroundJobQueue, InvalidBackgroundJobPayloadError } from '../../../packages/core-api/src/modules/background-jobs';
import { inMemoryBackgroundJobs, TEST_JOB_START, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { buildContest } from '../../factories';
import { fakeLogger } from '../../support/fake-logger';

const SPORT_EVENT = { id: 'sport-event-1', name: 'Masters Tournament', startDate: new Date('2026-04-23T11:40:00.000Z') } as SportEvent;

function setup(options: { contest?: ReturnType<typeof buildContest> | null; sportEvent?: SportEvent | null } = {}) {
  const contest = options.contest === undefined ? buildContest({ id: 'contest-1', status: ContestStatus.COMPLETED, contestFormat: ContestFormat.SQUARES }) : options.contest;
  const sportEvent = options.sportEvent === undefined ? SPORT_EVENT : options.sportEvent;
  const logger = fakeLogger();
  const notices = {
    contestStarted: jest.fn<Promise<number>, Parameters<ContestEmailJobDeps['notices']['contestStarted']>>(async () => 2),
    contestSettled: jest.fn<Promise<number>, Parameters<ContestEmailJobDeps['notices']['contestSettled']>>(async () => 2),
    contestEventChanged: jest.fn<Promise<number>, Parameters<ContestEmailJobDeps['notices']['contestEventChanged']>>(async () => 2),
    contestReopened: jest.fn<Promise<number>, Parameters<ContestEmailJobDeps['notices']['contestReopened']>>(async () => 2),
  };
  const standings = [
    { contestEntryId: 'entry-2', position: 2, displayPosition: '2', totalScore: 1 },
    { contestEntryId: 'entry-1', position: 1, displayPosition: '1', totalScore: 3 },
  ];
  const jobs = new ContestEmailJobs({
    contests: { findById: jest.fn(async () => contest) },
    sportEvents: { findById: jest.fn(async () => sportEvent) },
    finalStandings: {
      configurations: { findByContest: jest.fn(async () => null) },
      scoringRules: { findByContestConfiguration: jest.fn(async () => []) },
      standings: { findByContest: jest.fn(async () => standings) },
      entries: {
        findByContestWithSquad: jest.fn(async () => [
          { id: 'entry-1', name: 'Alpha', squadId: 'squad-1', squadName: 'Team One', entryNumber: 1 },
          { id: 'entry-2', name: 'Bravo', squadId: 'squad-2', squadName: 'Team Two', entryNumber: 1 },
        ]),
      },
    } as unknown as ContestEmailJobDeps['finalStandings'],
    notices,
    logger,
  });
  return { jobs, notices, logger, contest };
}

describe('ContestEmailJobs', () => {
  it('asks for the good luck emails of the contest and the event its job names', async () => {
    const { jobs, notices, contest } = setup();

    await expect(jobs.contestStarted({ contestId: 'contest-1', sportEventId: SPORT_EVENT.id })).resolves.toEqual({ changedCount: 2 });

    expect(notices.contestStarted).toHaveBeenCalledWith(contest, SPORT_EVENT);
  });

  it('skips the good luck emails, and says why, when the contest or its event is gone', async () => {
    for (const gone of [{ contest: null }, { sportEvent: null }]) {
      const { jobs, notices, logger } = setup(gone);

      await expect(jobs.contestStarted({ contestId: 'contest-1', sportEventId: SPORT_EVENT.id })).resolves.toEqual({ changedCount: 0 });

      expect(notices.contestStarted).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { action: 'email.contestStarted.skipped', data: { contestId: 'contest-1' } },
        expect.any(String),
      );
    }
  });

  it('asks for the final results emails with the contest\'s final places read again, best first', async () => {
    const { jobs, notices, contest } = setup();

    await jobs.contestSettled({ contestId: 'contest-1' });

    expect(notices.contestSettled).toHaveBeenCalledWith(contest, {
      scoringDefinitionId: null,
      entries: [
        { entryId: 'entry-1', entryName: 'Alpha', squadId: 'squad-1', squadName: 'Team One', position: 1, displayPosition: '1', score: 3 },
        { entryId: 'entry-2', entryName: 'Bravo', squadId: 'squad-2', squadName: 'Team Two', position: 2, displayPosition: '2', score: 1 },
      ],
    });
  });

  it('skips the final results emails of a contest no longer completed, since its next settlement queues its own job', async () => {
    const { jobs, notices, logger } = setup({ contest: buildContest({ id: 'contest-1', status: ContestStatus.ACTIVE }) });

    await jobs.contestSettled({ contestId: 'contest-1' });

    expect(notices.contestSettled).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'email.contestSettled.skipped', data: { contestId: 'contest-1' } },
      expect.any(String),
    );
  });

  it('lets a failure to queue the emails throw, so the runner retries the job', async () => {
    const { jobs, notices } = setup();
    notices.contestSettled.mockRejectedValueOnce(new Error('outbox unavailable'));

    await expect(jobs.contestSettled({ contestId: 'contest-1' })).rejects.toThrow('outbox unavailable');
  });
});

describe('contest email job requests', () => {
  const queue = new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs(), currentStart: testCurrentJobStart });

  it('keys each job by its type and contest, so a second move before it runs queues nothing more', () => {
    expect(contestStartedEmailsJob(queue, 'contest-1', 'sport-event-1')).toEqual({
      type: BackgroundJobType.CONTEST_STARTED_EMAILS,
      payload: { contestId: 'contest-1', sportEventId: 'sport-event-1' },
      sportEventId: 'sport-event-1',
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'CONTEST_STARTED_EMAILS:contest-1',
    });
    expect(contestSettledEmailsJob(queue, 'contest-1')).toEqual({
      type: BackgroundJobType.CONTEST_SETTLED_EMAILS,
      payload: { contestId: 'contest-1' },
      runAt: undefined,
      start: TEST_JOB_START,
      dedupeKey: 'CONTEST_SETTLED_EMAILS:contest-1',
    });
  });

  it('refuses a job naming no contest where it is made', () => {
    expect(() => contestSettledEmailsJob(queue, '')).toThrow(InvalidBackgroundJobPayloadError);
    expect(() => contestStartedEmailsJob(queue, 'contest-1', '')).toThrow(InvalidBackgroundJobPayloadError);
  });

  describe('contestEventChanged (#1458)', () => {
    const change = { kind: 'RESCHEDULED', startsAt: '2026-04-16T11:40:00.000Z', previousStart: '2026-04-09T11:40:00.000Z' } as const;

    it('asks for the event changed emails of the contest, with the event at the start the change left it, whatever the contest\'s status now', async () => {
      const { jobs, notices, contest } = setup();

      await jobs.contestEventChanged({ contestId: 'contest-1', sportEventId: SPORT_EVENT.id, change });

      expect(notices.contestEventChanged).toHaveBeenCalledWith(contest, { ...SPORT_EVENT, startDate: new Date(change.startsAt) }, change);
    });

    it('skips the event changed emails, and says why, when the contest or its event is gone', async () => {
      for (const gone of [{ contest: null }, { sportEvent: null }]) {
        const { jobs, notices, logger } = setup(gone);

        await jobs.contestEventChanged({ contestId: 'contest-1', sportEventId: SPORT_EVENT.id, change });

        expect(notices.contestEventChanged).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith({ action: 'email.sportEventChanged.skipped', data: { contestId: 'contest-1' } }, expect.any(String));
      }
    });

    it('lets a failure to queue the emails throw, so the runner retries the job', async () => {
      const { jobs, notices } = setup();
      notices.contestEventChanged.mockRejectedValueOnce(new Error('outbox unavailable'));

      await expect(jobs.contestEventChanged({ contestId: 'contest-1', sportEventId: SPORT_EVENT.id, change })).rejects.toThrow('outbox unavailable');
    });

    it('builds a job keyed by the contest and the change, and refuses a change with no start', () => {
      const queue = new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs(), currentStart: testCurrentJobStart });

      expect(contestEventChangedEmailsJob(queue, 'contest-1', { id: 'sport-event-1', startDate: new Date('2026-04-16T11:40:00.000Z') }, { kind: 'CANCELLED' })).toEqual({
        type: BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS,
        payload: { contestId: 'contest-1', sportEventId: 'sport-event-1', change: { kind: 'CANCELLED', startsAt: '2026-04-16T11:40:00.000Z' } },
        sportEventId: 'sport-event-1',
        runAt: undefined,
        start: TEST_JOB_START,
        dedupeKey: 'CONTEST_EVENT_CHANGED_EMAILS:contest-1:sport-event-1:cancelled-2026-04-16T11:40:00.000Z',
      });
      expect(() => queue.request(BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS, { contestId: 'contest-1', sportEventId: 'sport-event-1', change: { kind: 'CANCELLED' } } as never))
        .toThrow(InvalidBackgroundJobPayloadError);
    });
  });

  describe('contestReopened (#1808)', () => {
    const reopen = { contestId: 'contest-1', sportEventId: SPORT_EVENT.id, startsAt: '2026-04-30T11:40:00.000Z' };
    const reopenedContest = () => buildContest({ id: 'contest-1', status: ContestStatus.OPEN, startsAt: new Date(reopen.startsAt) });

    it('asks for the picks are open again emails of a contest still open to the start its job names', async () => {
      const { jobs, notices, contest } = setup({ contest: reopenedContest() });

      await jobs.contestReopened(reopen);

      expect(notices.contestReopened).toHaveBeenCalledWith(contest, SPORT_EVENT, reopen);
    });

    it('sends nothing, and says why, when the contest went live again or reopened to another start before the job ran', async () => {
      for (const moved of [
        buildContest({ id: 'contest-1', status: ContestStatus.ACTIVE, startsAt: new Date(reopen.startsAt) }),
        buildContest({ id: 'contest-1', status: ContestStatus.OPEN, startsAt: new Date('2026-05-07T11:40:00.000Z') }),
      ]) {
        const { jobs, notices, logger } = setup({ contest: moved });

        await jobs.contestReopened(reopen);

        expect(notices.contestReopened).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith({ action: 'email.contestReopened.skipped', data: { contestId: 'contest-1' } }, expect.any(String));
      }
    });

    it('sends nothing, and says why, when the contest or its event is gone', async () => {
      for (const gone of [{ contest: null }, { contest: reopenedContest(), sportEvent: null }]) {
        const { jobs, notices, logger } = setup(gone);

        await jobs.contestReopened(reopen);

        expect(notices.contestReopened).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith({ action: 'email.contestReopened.skipped', data: { contestId: 'contest-1' } }, expect.any(String));
      }
    });

    it('builds a job keyed by the contest, the event and the new start, so a later reopen is its own job', () => {
      const queue = new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs(), currentStart: testCurrentJobStart });

      expect(contestReopenedEmailsJob(queue, 'contest-1', 'sport-event-1', new Date(reopen.startsAt))).toEqual({
        type: BackgroundJobType.CONTEST_REOPENED_EMAILS,
        payload: { contestId: 'contest-1', sportEventId: 'sport-event-1', startsAt: reopen.startsAt },
        sportEventId: 'sport-event-1',
        runAt: undefined,
        start: TEST_JOB_START,
        dedupeKey: 'CONTEST_REOPENED_EMAILS:contest-1:sport-event-1:reopened-2026-04-30T11:40:00.000Z',
      });
    });
  });
});
