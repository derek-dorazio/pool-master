import { expect } from '@jest/globals';
import { BackgroundJobKind, BackgroundJobStatus, BackgroundJobType, JobTrigger, type BackgroundJob } from '@poolmaster/shared/domain';
import { ActivityService } from '../../../packages/core-api/src/modules/activity/activity-service';
import { SCHEDULED_SCORES_RUN } from '../../support/sync-run-fixtures';

// What Activity asks the job table for (#1819): the window a read gets when it names none, the
// job types a kind means, and each job's sync runs. The read itself is tested against Postgres
// in background-jobs.integration.ts.

const NOW = new Date('2026-11-18T12:00:00.000Z');
const HOUR = 60 * 60_000;

function job(id: string): BackgroundJob {
  return { id, type: BackgroundJobType.SYNC_LEAGUE_EVENTS, payload: {}, status: BackgroundJobStatus.SUCCEEDED, runAt: NOW, attempts: 1, trigger: JobTrigger.SCHEDULE, createdAt: NOW };
}

function build(jobs: BackgroundJob[] = []) {
  const findActivity = jest.fn().mockResolvedValue(jobs);
  const findByBackgroundJobIds = jest.fn().mockResolvedValue([
    { id: 'run-2', providerId: 'p', sport: 'GOLF', eventId: null, ...SCHEDULED_SCORES_RUN, backgroundJobId: 'job-1', status: 'COMPLETED', startedAt: null, completedAt: null, createdAt: NOW, payload: {} },
    { id: 'run-3', providerId: 'p', sport: 'GOLF', eventId: null, ...SCHEDULED_SCORES_RUN, backgroundJobId: 'job-1', status: 'FAILED', startedAt: null, completedAt: null, createdAt: NOW, payload: {} },
  ]);
  const service = new ActivityService({ jobs: { findActivity }, syncRuns: { findByBackgroundJobIds }, now: () => NOW });
  return { service, findActivity, findByBackgroundJobIds };
}

describe('ActivityService', () => {
  it('reads the last 24 hours when no league or event narrows the read', async () => {
    const { service, findActivity } = build();

    await service.list({});

    expect(findActivity).toHaveBeenCalledWith(expect.objectContaining({ createdFrom: new Date(NOW.getTime() - 24 * HOUR), createdTo: NOW }));
  });

  it('reads every job kept, 30 days, when a league or an event narrows the read', async () => {
    const { service, findActivity } = build();

    await service.list({ sportLeagueId: 'league-1' });
    await service.list({ sportEventId: 'event-1' });

    for (const [filter] of findActivity.mock.calls) {
      expect(filter).toMatchObject({ createdFrom: new Date(NOW.getTime() - 30 * 24 * HOUR), createdTo: NOW });
    }
  });

  it('keeps a window the caller gives, and asks for the job types of the kind it names', async () => {
    const { service, findActivity } = build();
    const from = new Date('2026-11-01T00:00:00.000Z');
    const to = new Date('2026-11-02T00:00:00.000Z');

    await service.list({ kind: BackgroundJobKind.SETTLEMENT, status: BackgroundJobStatus.FAILED, from, to });

    expect(findActivity).toHaveBeenCalledWith({
      types: [BackgroundJobType.SETTLE_SPORT_EVENT_CONTESTS, BackgroundJobType.SETTLE_GAME_CONTESTS],
      status: BackgroundJobStatus.FAILED,
      sportLeagueId: undefined,
      sportEventId: undefined,
      createdFrom: from,
      createdTo: to,
    });
  });

  it('refuses a window whose from is after its to with ACTIVITY_WINDOW_INVALID, reading nothing', async () => {
    const { service, findActivity } = build();

    await expect(service.list({ from: NOW, to: new Date(NOW.getTime() - HOUR) })).rejects.toMatchObject({ statusCode: 400, code: 'ACTIVITY_WINDOW_INVALID' });
    expect(findActivity).not.toHaveBeenCalled();
  });

  it('names each job\'s sync runs, read in one call for every job, and none for a job that ran none', async () => {
    const { service, findByBackgroundJobIds } = build([job('job-1'), job('job-2')]);

    const listed = await service.list({});

    expect(findByBackgroundJobIds).toHaveBeenCalledTimes(1);
    expect(findByBackgroundJobIds).toHaveBeenCalledWith(['job-1', 'job-2']);
    expect(listed.map(({ job: listedJob, syncRunIds }) => [listedJob.id, syncRunIds])).toEqual([['job-1', ['run-2', 'run-3']], ['job-2', []]]);
  });
});
