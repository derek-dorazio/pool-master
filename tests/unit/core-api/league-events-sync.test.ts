import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  BackgroundJobStatus,
  BackgroundJobType,
  ProviderSyncKind,
  ProviderSyncRunStatus,
  ProviderSyncTrigger,
  Sport,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { BackgroundJobQueue, BackgroundJobRunner } from '../../../packages/core-api/src/modules/background-jobs';
import { EventScoreSourceError } from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { CLUTCH_CARD_SYNC_DELAY_MS, LeagueEventsSync } from '../../../packages/core-api/src/modules/events/league-events-sync';
import type { ProviderEventDetailsChange, ProviderEventYearImport } from '../../../packages/core-api/src/modules/events/service';
import { buildSportLeague } from '../../factories';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryBackgroundJobs, jobHandlers } from '../../support/in-memory-background-jobs';
import { inMemorySyncRuns } from '../../support/in-memory-sync-runs';

// A sport league's events sync (#1819): what its job does with the provider's events, the run it
// records, how a failure ends it, and the two triggers (the schedule and an admin's Sync now)
// that queue it. The job runs on the real runner over the in-memory job table. That the import
// creates DRAFT events, linked, and skips what exists is importProviderEventYear's, proved in
// sport-event-service.test.ts and against Postgres in synced-event-creation.integration.ts.

const NOW = new Date('2026-11-13T12:00:00Z');

function providerEvent(externalId: string) {
  return { externalId, name: `Event ${externalId}`, venue: null, startDate: new Date('2026-12-01T00:00:00Z'), endDate: null };
}

function created(name: string): ProviderEventYearImport['created'][number] {
  return { event: { id: randomUUID(), name } } as ProviderEventYearImport['created'][number];
}

type ListTourEvents = jest.Mock<Promise<Array<ReturnType<typeof providerEvent>>>, [string, string, number]>;

function build(options: {
  leagues: SportLeague[];
  listTourEventsForYear?: ListTourEvents;
  importProviderEventYear?: jest.Mock;
  keepProviderEventsCurrent?: jest.Mock;
  /** False leaves queued jobs waiting until the test drains the runner. */
  wakes?: boolean;
}) {
  const jobs = inMemoryBackgroundJobs(() => NOW);
  const syncRuns = inMemorySyncRuns(jobs);
  const queue = new BackgroundJobQueue({ jobs });
  const scoreSource = {
    listTourEventsForYear: options.listTourEventsForYear
      ?? jest.fn<ReturnType<ListTourEvents>, Parameters<ListTourEvents>>(async (_providerId, sportLeagueId, eventYear) => [providerEvent(`${sportLeagueId}-${eventYear}`)]),
  };
  const sportEvents = {
    importProviderEventYear: options.importProviderEventYear
      ?? jest.fn(async ({ eventYear }: { eventYear: number }): Promise<ProviderEventYearImport> => ({
        created: [created(`Open ${String(eventYear)}`)],
        skipped: [{ externalId: 'old', name: 'Old Open', reason: 'ALREADY_LINKED' }],
      })),
    keepProviderEventsCurrent: options.keepProviderEventsCurrent ?? jest.fn(async (): Promise<ProviderEventDetailsChange[]> => []),
  };
  const sportLeagues = {
    findById: jest.fn(async (id: string) => options.leagues.find((league) => league.id === id) ?? null),
    findEventSynced: jest.fn(async () => options.leagues.filter((league) => league.eventSyncProviderId !== null && league.isActive)),
  };
  const logger = fakeLogger();
  const sync = new LeagueEventsSync({
    sportLeagues,
    sports: { findById: jest.fn(async () => ({ sport: Sport.GOLF }) as never) },
    scoreSource,
    sportEvents,
    syncRuns,
    jobs: queue,
    logger,
    now: () => NOW,
  });
  const runner = new BackgroundJobRunner({
    jobs,
    handlers: jobHandlers({ SYNC_LEAGUE_EVENTS: (payload, context) => sync.run(payload, context) }),
    now: () => NOW,
    sleep: () => Promise.resolve(),
  });
  if (options.wakes !== false) queue.wakes(runner);
  return { sync, runner, jobs, syncRuns, scoreSource, sportEvents, logger };
}

/** A lease renewal for a try that still holds its claim. */
const stillHeld = () => Promise.resolve(true);

function syncedLeague(overrides: Partial<SportLeague> = {}): SportLeague {
  return buildSportLeague({ id: randomUUID(), name: 'PGA TOUR', matchKeyword: 'PGA TOUR', eventSyncProviderId: 'balldontlie', ...overrides });
}

describe('LeagueEventsSync', () => {
  describe('the schedule', () => {
    it('queues one events sync job per active synced league, for this calendar year and the next, scoped to the league', async () => {
      const pga = syncedLeague();
      const lpga = syncedLeague({ name: 'LPGA', matchKeyword: 'LPGA' });
      const unsynced = syncedLeague({ eventSyncProviderId: null });
      const { sync, jobs } = build({ leagues: [pga, lpga, unsynced], wakes: false });

      await expect(sync.queueScheduled()).resolves.toBe(2);

      expect(jobs.rows.map((job) => [job.type, job.sportLeagueId, job.sportEventId, job.payload])).toEqual([
        [BackgroundJobType.SYNC_LEAGUE_EVENTS, pga.id, undefined, { sportLeagueId: pga.id, eventYears: [2026, 2027], trigger: ProviderSyncTrigger.SCHEDULE }],
        [BackgroundJobType.SYNC_LEAGUE_EVENTS, lpga.id, undefined, { sportLeagueId: lpga.id, eventYears: [2026, 2027], trigger: ProviderSyncTrigger.SCHEDULE }],
      ]);
    });

    it('makes each Clutch Card league\'s job due after the season leagues\' jobs, so a new season event is there for its rounds to link to', async () => {
      const worldSeries = syncedLeague({ name: 'League Championship Series', scoringFamily: 'COMPOSITE' });
      const mlb = syncedLeague({ name: 'MLB', matchKeyword: 'MLB' });
      const { sync, jobs } = build({ leagues: [worldSeries, mlb], wakes: false });

      await sync.queueScheduled();

      const runAtOf = (id: string) => jobs.rows.find((job) => job.sportLeagueId === id)?.runAt;
      expect(runAtOf(mlb.id)).toEqual(NOW);
      expect(runAtOf(worldSeries.id)).toEqual(new Date(NOW.getTime() + CLUTCH_CARD_SYNC_DELAY_MS));
    });

    it('queues nothing more for a league whose sync is still waiting to run', async () => {
      const pga = syncedLeague();
      const { sync, jobs } = build({ leagues: [pga], wakes: false });

      await sync.queueScheduled();
      await expect(sync.queueScheduled()).resolves.toBe(0);

      expect(jobs.rows).toHaveLength(1);
    });
  });

  describe('Sync now', () => {
    it('queues the league\'s sync for the one year asked, by the admin, and answers the queued job', async () => {
      const pga = syncedLeague();
      const { sync, jobs } = build({ leagues: [pga], wakes: false });
      const adminId = randomUUID();

      const job = await sync.syncNow({ sportLeagueId: pga.id, eventYear: 2027, requestedByUserId: adminId });

      expect(job).toMatchObject({ type: BackgroundJobType.SYNC_LEAGUE_EVENTS, sportLeagueId: pga.id });
      expect(jobs.rows.map((row) => row.payload)).toEqual([
        { sportLeagueId: pga.id, eventYears: [2027], trigger: ProviderSyncTrigger.ADMIN, requestedByUserId: adminId },
      ]);
    });

    it('syncs this calendar year and the next when no year is asked', async () => {
      const pga = syncedLeague();
      const { sync, jobs } = build({ leagues: [pga], wakes: false });

      await sync.syncNow({ sportLeagueId: pga.id, requestedByUserId: randomUUID() });

      expect(jobs.rows[0]?.payload).toMatchObject({ eventYears: [2026, 2027] });
    });

    it('answers the job already waiting for the league\'s same years rather than queueing a second', async () => {
      const pga = syncedLeague();
      const { sync, jobs } = build({ leagues: [pga], wakes: false });
      await sync.queueScheduled();
      const waiting = jobs.rows[0];

      const job = await sync.syncNow({ sportLeagueId: pga.id, requestedByUserId: randomUUID() });

      expect(job.id).toBe(waiting.id);
      expect(jobs.rows).toHaveLength(1);
    });

    it('queues a job of its own for another year while the scheduled sync waits, so last season is not dropped', async () => {
      const pga = syncedLeague();
      const { sync, jobs } = build({ leagues: [pga], wakes: false });
      await sync.queueScheduled();
      const waiting = jobs.rows[0];

      const job = await sync.syncNow({ sportLeagueId: pga.id, eventYear: 2025, requestedByUserId: randomUUID() });

      expect(job.id).not.toBe(waiting.id);
      expect(job.payload).toMatchObject({ eventYears: [2025], trigger: ProviderSyncTrigger.ADMIN });
      expect(jobs.rows).toHaveLength(2);
    });

    it('refuses a league that does not exist with SPORT_LEAGUE_NOT_FOUND and one no provider syncs with SPORT_LEAGUE_NOT_SYNCED', async () => {
      const unsynced = syncedLeague({ eventSyncProviderId: null });
      const { sync, jobs } = build({ leagues: [unsynced] });

      await expect(sync.syncNow({ sportLeagueId: randomUUID(), requestedByUserId: randomUUID() }))
        .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
      await expect(sync.syncNow({ sportLeagueId: unsynced.id, requestedByUserId: randomUUID() }))
        .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_SYNCED', statusCode: 422 });
      expect(jobs.rows).toHaveLength(0);
    });
  });

  describe('the job', () => {
    it('imports and keeps current each year\'s provider events with the league\'s own provider, the import first', async () => {
      const pga = syncedLeague();
      const { sync, runner, scoreSource, sportEvents } = build({ leagues: [pga] });

      await sync.queueScheduled();
      await runner.drain();

      expect(scoreSource.listTourEventsForYear.mock.calls).toEqual([['balldontlie', pga.id, 2026], ['balldontlie', pga.id, 2027]]);
      expect(sportEvents.importProviderEventYear.mock.calls).toEqual([
        [{ sportLeagueId: pga.id, eventYear: 2026, providerId: 'balldontlie', providerEvents: [providerEvent(`${pga.id}-2026`)] }],
        [{ sportLeagueId: pga.id, eventYear: 2027, providerId: 'balldontlie', providerEvents: [providerEvent(`${pga.id}-2027`)] }],
      ]);
      expect(sportEvents.keepProviderEventsCurrent.mock.calls).toEqual([
        [{ sportLeagueId: pga.id, providerId: 'balldontlie', providerEvents: [providerEvent(`${pga.id}-2026`)] }],
        [{ sportLeagueId: pga.id, providerId: 'balldontlie', providerEvents: [providerEvent(`${pga.id}-2027`)] }],
      ]);
      expect(sportEvents.importProviderEventYear.mock.invocationCallOrder[0]).toBeLessThan(sportEvents.keepProviderEventsCurrent.mock.invocationCallOrder[0]);
    });

    it('records one COMPLETED EVENTS run linked to its job, with each event it created, updated and skipped, and reports the counts as its result', async () => {
      const pga = syncedLeague();
      const movedId = randomUUID();
      const keepProviderEventsCurrent = jest.fn()
        .mockResolvedValueOnce([{ sportEventId: movedId, externalId: 'moved', changed: ['startDate'] }])
        .mockResolvedValue([]);
      const { sync, runner, jobs, syncRuns } = build({ leagues: [pga], keepProviderEventsCurrent });

      await sync.queueScheduled();
      await runner.drain();

      const [job] = jobs.rows;
      const [run] = syncRuns.rows;
      expect(syncRuns.rows).toHaveLength(1);
      expect(run).toMatchObject({
        providerId: 'balldontlie',
        sport: Sport.GOLF,
        eventId: null,
        kind: ProviderSyncKind.EVENTS,
        trigger: ProviderSyncTrigger.SCHEDULE,
        sportLeagueId: pga.id,
        sportEventId: null,
        backgroundJobId: job.id,
        status: ProviderSyncRunStatus.COMPLETED,
        completedAt: NOW,
        payload: expect.objectContaining({ runType: 'LEAGUE_EVENTS_SYNC', stats: { created: 2, updated: 1, skipped: 2, alreadyStarted: 0 } }),
      });
      const details = syncRuns.update.mock.calls.at(-1)?.[1].details as { years: Array<{ eventYear: number; created: unknown[]; updated: unknown[] }> };
      expect(details.years.map((year) => [year.eventYear, year.created.length, year.updated])).toEqual([
        [2026, 1, [{ sportEventId: movedId, externalId: 'moved', changed: ['startDate'] }]],
        [2027, 1, []],
      ]);
      expect(job).toMatchObject({
        status: BackgroundJobStatus.SUCCEEDED,
        result: { syncRunId: run.id, eventYears: [2026, 2027], created: 2, updated: 1, skipped: 2, alreadyStarted: 0 },
      });
    });

    it('counts the provider events it skipped because they had already started, on the run and in its result', async () => {
      const pga = syncedLeague();
      const importProviderEventYear = jest.fn(async (): Promise<ProviderEventYearImport> => ({
        created: [],
        skipped: [
          { externalId: 'w1', name: 'Week 1', reason: 'ALREADY_STARTED' },
          { externalId: 'w2', name: 'Week 2', reason: 'ALREADY_LINKED' },
        ],
      }));
      const { sync, syncRuns } = build({ leagues: [pga], importProviderEventYear });

      const result = await sync.run({ sportLeagueId: pga.id, eventYears: [2026], trigger: ProviderSyncTrigger.SCHEDULE }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld });

      expect(result).toMatchObject({ skipped: 2, alreadyStarted: 1 });
      expect(syncRuns.rows[0]?.payload).toMatchObject({ stats: { skipped: 2, alreadyStarted: 1 } });
    });

    it('shows its progress on the run after each year while it runs', async () => {
      const pga = syncedLeague();
      const { sync, runner, syncRuns } = build({ leagues: [pga] });

      await sync.queueScheduled();
      await runner.drain();

      const inProgress = syncRuns.update.mock.calls.filter(([, update]) => update.status === ProviderSyncRunStatus.IN_PROGRESS);
      expect(inProgress.map(([, update]) => update.payload['progress'])).toEqual([{ yearsDone: 1, yearCount: 2 }, { yearsDone: 2, yearCount: 2 }]);
    });

    it('fails the job at once, with no retry, when the provider\'s plan refuses the league, and marks its run FAILED with the code', async () => {
      const pga = syncedLeague();
      const listTourEventsForYear = jest.fn<ReturnType<ListTourEvents>, Parameters<ListTourEvents>>()
        .mockRejectedValue(new EventScoreSourceError('Your plan does not include the PGA TOUR.', 'PROVIDER_LEAGUE_REFUSED', 422));
      const { sync, runner, jobs, syncRuns, logger } = build({ leagues: [pga], listTourEventsForYear });

      await sync.queueScheduled();
      await runner.drain();

      expect(jobs.rows[0]).toMatchObject({ status: BackgroundJobStatus.FAILED, attempts: 1, lastError: expect.stringContaining('PROVIDER_LEAGUE_REFUSED') });
      expect(syncRuns.rows[0]).toMatchObject({ status: ProviderSyncRunStatus.FAILED });
      expect(syncRuns.update.mock.calls.at(-1)?.[1].details).toMatchObject({
        failurePayload: { error: { code: 'PROVIDER_LEAGUE_REFUSED', message: 'Your plan does not include the PGA TOUR.' } },
      });
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'events.leagueSync.failed' }), expect.any(String));
    });

    it('leaves a failure a retry may fix, such as the provider being unreachable, for the runner to try again, keeping the years it finished on the run', async () => {
      const pga = syncedLeague();
      const listTourEventsForYear = jest.fn<ReturnType<ListTourEvents>, Parameters<ListTourEvents>>(async (_providerId, sportLeagueId, eventYear) => {
        if (eventYear === 2027) throw new Error('vendor unavailable');
        return [providerEvent(`${sportLeagueId}-${String(eventYear)}`)];
      });
      const { sync, runner, jobs, syncRuns } = build({ leagues: [pga], listTourEventsForYear });

      await sync.queueScheduled();
      await runner.drain();

      expect(jobs.rows[0]).toMatchObject({ status: BackgroundJobStatus.QUEUED, attempts: 1, lastError: 'vendor unavailable' });
      expect(syncRuns.rows[0]).toMatchObject({ status: ProviderSyncRunStatus.FAILED, payload: expect.objectContaining({ stats: { created: 1, updated: 0, skipped: 1, alreadyStarted: 0 } }) });
    });

    it('marks the run an earlier try left IN_PROGRESS as interrupted, then records its own', async () => {
      const pga = syncedLeague();
      const { sync, syncRuns } = build({ leagues: [pga] });
      const jobId = randomUUID();
      const stale = await syncRuns.create({
        providerId: 'balldontlie', sport: Sport.GOLF, eventId: null, kind: ProviderSyncKind.EVENTS, trigger: ProviderSyncTrigger.SCHEDULE,
        sportLeagueId: pga.id, sportEventId: null, backgroundJobId: jobId, status: ProviderSyncRunStatus.IN_PROGRESS,
        startedAt: NOW, completedAt: null, payload: {},
      });

      await sync.run({ sportLeagueId: pga.id, eventYears: [2026], trigger: ProviderSyncTrigger.SCHEDULE }, { jobId, attempt: 2, renewLease: stillHeld });

      expect(syncRuns.rows.map((run) => [run.id === stale.id, run.status])).toEqual([[true, ProviderSyncRunStatus.FAILED], [false, ProviderSyncRunStatus.COMPLETED]]);
      expect(syncRuns.rows[0]?.payload).toMatchObject({ detail: expect.stringContaining('Interrupted') });
    });

    it('stops before importing when another task has claimed the job, and marks its own run FAILED', async () => {
      const pga = syncedLeague();
      const { sync, syncRuns, sportEvents } = build({ leagues: [pga] });

      await expect(sync.run({ sportLeagueId: pga.id, eventYears: [2026], trigger: ProviderSyncTrigger.SCHEDULE }, { jobId: randomUUID(), attempt: 1, renewLease: () => Promise.resolve(false) }))
        .rejects.toThrow('Another try took over');
      expect(sportEvents.importProviderEventYear).not.toHaveBeenCalled();
      expect(syncRuns.rows.map((run) => run.status)).toEqual([ProviderSyncRunStatus.FAILED]);
    });

    it('renews its lease before each year, so a sync slowed by the provider keeps its claim', async () => {
      const pga = syncedLeague();
      const { sync } = build({ leagues: [pga] });
      const renewLease = jest.fn(stillHeld);

      await sync.run({ sportLeagueId: pga.id, eventYears: [2026, 2027], trigger: ProviderSyncTrigger.SCHEDULE }, { jobId: randomUUID(), attempt: 1, renewLease });

      expect(renewLease).toHaveBeenCalledTimes(2);
    });

    it('fails at once, recording no run, for a league gone or no longer synced', async () => {
      const unsynced = syncedLeague({ eventSyncProviderId: null });
      const { sync, syncRuns } = build({ leagues: [unsynced] });

      await expect(sync.run({ sportLeagueId: randomUUID(), eventYears: [2026], trigger: ProviderSyncTrigger.ADMIN }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld }))
        .rejects.toMatchObject({ name: 'PermanentBackgroundJobError' });
      await expect(sync.run({ sportLeagueId: unsynced.id, eventYears: [2026], trigger: ProviderSyncTrigger.ADMIN }, { jobId: randomUUID(), attempt: 1, renewLease: stillHeld }))
        .rejects.toMatchObject({ name: 'PermanentBackgroundJobError' });
      expect(syncRuns.rows).toHaveLength(0);
    });
  });
});
