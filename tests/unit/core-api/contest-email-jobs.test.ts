/**
 * The contest started and final results email jobs (#1387): each reads again what the request
 * that moved the contest no longer hands over, and asks the notices for the same emails.
 */
import { BackgroundJobType, ContestFormat, ContestStatus, type SportEvent } from '@poolmaster/shared/domain';
import {
  ContestEmailJobs,
  contestSettledEmailsJob,
  contestStartedEmailsJob,
  type ContestEmailJobDeps,
} from '../../../packages/core-api/src/modules/notifications';
import { BackgroundJobQueue, InvalidBackgroundJobPayloadError } from '../../../packages/core-api/src/modules/background-jobs';
import { inMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';
import { buildContest } from '../../factories';
import { fakeLogger } from '../../support/fake-logger';

const SPORT_EVENT = { id: 'sport-event-1', name: 'Masters Tournament' } as SportEvent;

function setup(options: { contest?: ReturnType<typeof buildContest> | null; sportEvent?: SportEvent | null } = {}) {
  const contest = options.contest === undefined ? buildContest({ id: 'contest-1', status: ContestStatus.COMPLETED, contestFormat: ContestFormat.SQUARES }) : options.contest;
  const sportEvent = options.sportEvent === undefined ? SPORT_EVENT : options.sportEvent;
  const logger = fakeLogger();
  const notices = {
    contestStarted: jest.fn<Promise<void>, Parameters<ContestEmailJobDeps['notices']['contestStarted']>>(async () => undefined),
    contestSettled: jest.fn<Promise<void>, Parameters<ContestEmailJobDeps['notices']['contestSettled']>>(async () => undefined),
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

    await jobs.contestStarted({ contestId: 'contest-1', sportEventId: SPORT_EVENT.id });

    expect(notices.contestStarted).toHaveBeenCalledWith(contest, SPORT_EVENT);
  });

  it('skips the good luck emails, and says why, when the contest or its event is gone', async () => {
    for (const gone of [{ contest: null }, { sportEvent: null }]) {
      const { jobs, notices, logger } = setup(gone);

      await jobs.contestStarted({ contestId: 'contest-1', sportEventId: SPORT_EVENT.id });

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
  const queue = new BackgroundJobQueue({ jobs: inMemoryBackgroundJobs() });

  it('keys each job by its type and contest, so a second move before it runs queues nothing more', () => {
    expect(contestStartedEmailsJob(queue, 'contest-1', 'sport-event-1')).toEqual({
      type: BackgroundJobType.CONTEST_STARTED_EMAILS,
      payload: { contestId: 'contest-1', sportEventId: 'sport-event-1' },
      runAt: undefined,
      dedupeKey: 'CONTEST_STARTED_EMAILS:contest-1',
    });
    expect(contestSettledEmailsJob(queue, 'contest-1')).toEqual({
      type: BackgroundJobType.CONTEST_SETTLED_EMAILS,
      payload: { contestId: 'contest-1' },
      runAt: undefined,
      dedupeKey: 'CONTEST_SETTLED_EMAILS:contest-1',
    });
  });

  it('refuses a job naming no contest where it is made', () => {
    expect(() => contestSettledEmailsJob(queue, '')).toThrow(InvalidBackgroundJobPayloadError);
    expect(() => contestStartedEmailsJob(queue, 'contest-1', '')).toThrow(InvalidBackgroundJobPayloadError);
  });
});
