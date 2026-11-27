/**
 * Unit tests: the sync tick (#2009), the one scheduler of provider syncs. Each tick queues the due
 * events, field and scores syncs as jobs, paced by each subject's latest job, with fake reads of
 * the slots and Games and an in-memory job table.
 */

import { randomUUID } from 'node:crypto';
import type { LiveEventView, SyncDueWorkReader } from '@poolmaster/shared/db';
import { BackgroundJobType, JobTrigger, MatchStatus, ProviderCode, ProviderSyncKind, type FieldWindowSlot, type SportLeague } from '@poolmaster/shared/domain';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs/background-job-queue';
import { SyncTick, type NotifiedProviderCadence } from '../../../packages/core-api/src/modules/ingestion/sync-tick';
import { eventSyncJob, EventSyncWait } from '../../../packages/core-api/src/modules/ingestion/event-sync-job-requests';
import { SCHEDULE_START } from '../../../packages/core-api/src/core/job-start';
import { buildProviderMapping, buildSportLeague } from '../../factories';
import { fakeLogger } from '../../support/fake-logger';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { inMemoryBackgroundJobs, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { heldElsewhere, heldHere } from '../../support/job-locks';

const NOW = new Date('2026-11-27T18:00:00.000Z');
const minutes = (count: number) => count * 60_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const PGA_PROVIDER_LEAGUE = 'pga-provider-league';

const SCHEDULE = {
  EVENTS: { enabled: true, intervalMinutes: 360 },
  FIELD: { intervalMinutes: 360 },
  SCORES: { enabled: true, intervalSeconds: 300 },
};

function league(overrides: Partial<SportLeague> = {}): SportLeague {
  return buildSportLeague({
    id: randomUUID(),
    isActive: true,
    selectedProviderMapping: buildProviderMapping({ id: randomUUID(), providerLeagueCode: 'nfl' }),
    ...overrides,
  });
}

function liveEvent(sportLeagueId: string, overrides: Partial<LiveEventView> = {}): LiveEventView {
  return {
    sportEventId: randomUUID(),
    sportLeagueId,
    games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(30)), playedAsField: false }],
    lastHeardAt: null,
    lastScoresChangedAt: null,
    ...overrides,
  };
}

function tickOf(options: {
  leagues: SportLeague[];
  slots?: FieldWindowSlot[];
  live?: LiveEventView[];
  schedule?: typeof SCHEDULE;
  cadence?: NotifiedProviderCadence;
  running?: boolean;
  lock?: 'here' | 'elsewhere';
}) {
  const findings = { raiseOfSource: jest.fn(async (_providerSourceId: string, _raises: unknown) => undefined) };
  let now = NOW;
  const jobs = inMemoryBackgroundJobs(() => now);
  const queue = new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart });
  const dueWork: SyncDueWorkReader = {
    findNextSlots: jest.fn(async () => options.slots ?? []),
    findLiveEvents: jest.fn(async () => options.live ?? []),
  };
  const sportLeagues = { findEventSynced: jest.fn(async () => options.leagues) };
  const logger = fakeLogger();
  const tick = new SyncTick({
    sportLeagues,
    dueWork,
    jobHistory: jobs,
    jobs: queue,
    registry: registryWith(options.running === false ? null : fakeSportDataProvider()),
    schedule: { getConfig: async () => options.schedule ?? SCHEDULE },
    notifiedProviderCadence: () => options.cadence,
    // Each provider league's own quiet window: a golf round's is hours, a game's minutes.
    quietAfterMs: (providerLeagueId) => (providerLeagueId === PGA_PROVIDER_LEAGUE ? minutes(240) : minutes(20)),
    findings,
    jobLock: options.lock === 'elsewhere' ? heldElsewhere() : heldHere(),
    now: () => now,
    logger,
  });
  return {
    tick,
    jobs,
    queue,
    dueWork,
    logger,
    findings,
    advance: (ms: number) => { now = new Date(now.getTime() + ms); },
    /** Every job's type and subject, as queued. */
    queued: () => jobs.rows.map((row) => ({ type: row.type, sportLeagueId: row.sportLeagueId, sportEventId: row.sportEventId })),
    /** The tick's jobs run and finish, releasing their dedupe keys, as the runner would. */
    finishAll: () => { for (const row of jobs.rows) Object.assign(row, { status: 'SUCCEEDED', dedupeKey: undefined }); },
  };
}

describe('SyncTick', () => {
  it("queues each synced league's events sync, the field of each event in its next slot, and the scores of each event with a Game in play, in one tick", async () => {
    const nfl = league();
    const fieldEvent = randomUUID();
    const live = liveEvent(nfl.id);
    const { tick, queued } = tickOf({
      leagues: [nfl],
      slots: [{ sportLeagueId: nfl.id, startsAt: at(minutes(60)), sportEventId: fieldEvent }],
      live: [live],
    });

    expect(await tick.tick()).toBe(3);

    expect(queued()).toEqual(expect.arrayContaining([
      { type: BackgroundJobType.SYNC_LEAGUE_EVENTS, sportLeagueId: nfl.id, sportEventId: undefined },
      { type: BackgroundJobType.SYNC_EVENT_FIELD, sportLeagueId: undefined, sportEventId: fieldEvent },
      { type: BackgroundJobType.SYNC_EVENT_SCORES, sportLeagueId: undefined, sportEventId: live.sportEventId },
    ]));
  });

  it('queues none of them again on a second tick in the same window, even once the first ones have run', async () => {
    const nfl = league();
    const { tick, jobs, advance, finishAll } = tickOf({
      leagues: [nfl],
      slots: [{ sportLeagueId: nfl.id, startsAt: at(minutes(60)), sportEventId: randomUUID() }],
      live: [liveEvent(nfl.id)],
    });
    await tick.tick();
    finishAll();
    advance(minutes(1));

    expect(await tick.tick()).toBe(0);
    expect(jobs.rows).toHaveLength(3);
  });

  it("still queues an event's scores while a follow-up scores sync waits for later, so a webhook's reconcile never pauses live polling", async () => {
    const nfl = league();
    const live = liveEvent(nfl.id);
    const { tick, queue, queued } = tickOf({ leagues: [nfl], live: [live] });
    await queue.enqueueAll([eventSyncJob(queue, ProviderSyncKind.SCORES, { sportEventId: live.sportEventId }, {
      start: SCHEDULE_START, providerCode: ProviderCode.BALLDONTLIE, runAt: at(minutes(10)), wait: EventSyncWait.RECONCILE,
    })]);

    await tick.tick();

    expect(queued().filter((job) => job.type === BackgroundJobType.SYNC_EVENT_SCORES)).toHaveLength(2);
  });

  it('queues the scores again once the SCORES interval has passed, and the field and events only after their own', async () => {
    const nfl = league();
    const live = liveEvent(nfl.id);
    const { tick, queued, advance, finishAll } = tickOf({
      leagues: [nfl],
      slots: [{ sportLeagueId: nfl.id, startsAt: at(minutes(600)), sportEventId: randomUUID() }],
      live: [live],
    });
    await tick.tick();
    finishAll();
    advance(minutes(5));

    await tick.tick();

    expect(queued().filter((job) => job.type === BackgroundJobType.SYNC_EVENT_SCORES)).toHaveLength(2);
    expect(queued().filter((job) => job.type !== BackgroundJobType.SYNC_EVENT_SCORES)).toHaveLength(2);
  });

  it('records each job as started by the schedule, keyed to its league\'s Provider, holding only our own ids', async () => {
    const nfl = league();
    const live = liveEvent(nfl.id);
    const { tick, jobs } = tickOf({ leagues: [nfl], live: [live] });

    await tick.tick();

    const scores = jobs.rows.find((row) => row.type === BackgroundJobType.SYNC_EVENT_SCORES);
    expect(scores).toMatchObject({ trigger: JobTrigger.SCHEDULE, payload: { sportEventId: live.sportEventId } });
    expect(JSON.stringify(jobs.rows.map((row) => [row.payload, row.dedupeKey]))).not.toContain('balldontlie');
  });

  it('queues no events or scores sync while their schedules are off, and still queues the field, which has no switch', async () => {
    const nfl = league();
    const { tick, queued } = tickOf({
      leagues: [nfl],
      slots: [{ sportLeagueId: nfl.id, startsAt: at(minutes(60)), sportEventId: randomUUID() }],
      live: [liveEvent(nfl.id)],
      schedule: { ...SCHEDULE, EVENTS: { enabled: false, intervalMinutes: 360 }, SCORES: { enabled: false, intervalSeconds: 300 } },
    });

    await tick.tick();

    expect(queued().map((job) => job.type)).toEqual([BackgroundJobType.SYNC_EVENT_FIELD]);
  });

  it('queues nothing, reading no slots or Games, for a league that is inactive, not synced, or synced from a provider not running here', async () => {
    const stopped = tickOf({ leagues: [league()], running: false });
    expect(await stopped.tick.tick()).toBe(0);
    expect(stopped.dueWork.findLiveEvents).not.toHaveBeenCalled();

    const unsynced = tickOf({ leagues: [league({ isActive: false }), league({ selectedProviderMapping: null })] });
    expect(await unsynced.tick.tick()).toBe(0);
    expect(unsynced.dueWork.findNextSlots).not.toHaveBeenCalled();
  });

  it('queues the field of only the next slot, never a later one or one already started', async () => {
    const nfl = league();
    const next = randomUUID();
    const { tick, queued } = tickOf({
      leagues: [nfl],
      schedule: { ...SCHEDULE, EVENTS: { enabled: false, intervalMinutes: 360 }, SCORES: { enabled: false, intervalSeconds: 300 } },
      slots: [
        { sportLeagueId: nfl.id, startsAt: at(-minutes(60)), sportEventId: randomUUID() },
        { sportLeagueId: nfl.id, startsAt: at(minutes(60)), sportEventId: next },
        { sportLeagueId: nfl.id, startsAt: at(minutes(60 * 24 * 7)), sportEventId: randomUUID() },
      ],
    });

    await tick.tick();

    expect(queued()).toEqual([{ type: BackgroundJobType.SYNC_EVENT_FIELD, sportLeagueId: undefined, sportEventId: next }]);
  });

  it('does nothing while another server task holds the tick\'s lock', async () => {
    const { tick, jobs } = tickOf({ leagues: [league()], lock: 'elsewhere' });

    await tick.runTick();

    expect(jobs.rows).toHaveLength(0);
  });

  describe('for a provider that sends webhook notifications (#1499)', () => {
    const cadence = (providerId = 'balldontlie'): NotifiedProviderCadence => ({
      providerIds: [providerId],
      pollIntervalMs: minutes(15),
      roundPollIntervalMs: minutes(2),
    });
    const scoresOnly = { ...SCHEDULE, EVENTS: { enabled: false, intervalMinutes: 360 } };

    it("syncs a notified provider's game event only every 15 minutes, while another provider's keeps the SCORES interval", async () => {
      const notified = league();
      const other = league({ selectedProviderMapping: buildProviderMapping({ id: randomUUID(), providerCode: ProviderCode.BALLDONTLIE, providerId: 'other-feed' }) });
      const [notifiedEvent, otherEvent] = [liveEvent(notified.id), liveEvent(other.id)];
      const { tick, queued, advance, finishAll } = tickOf({
        leagues: [notified, other],
        live: [notifiedEvent, otherEvent],
        schedule: scoresOnly,
        cadence: cadence(),
      });
      await tick.tick();
      finishAll();
      advance(minutes(5));
      await tick.tick();
      finishAll();
      advance(minutes(10));
      await tick.tick();

      const syncsOf = (event: LiveEventView) => queued().filter((job) => job.sportEventId === event.sportEventId).length;
      expect(syncsOf(notifiedEvent)).toBe(2);
      expect(syncsOf(otherEvent)).toBe(3);
    });

    it('syncs a notified event played as a FIELD (a golf round) every 2 minutes', async () => {
      const pga = league({ selectedProviderMapping: buildProviderMapping({ id: randomUUID(), providerLeagueId: PGA_PROVIDER_LEAGUE, providerLeagueCode: 'pga' }) });
      const round = liveEvent(pga.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(30)), playedAsField: true }] });
      const { tick, queued, advance, finishAll } = tickOf({ leagues: [pga], live: [round], schedule: scoresOnly, cadence: cadence() });
      await tick.tick();
      finishAll();
      advance(minutes(2));

      await tick.tick();

      expect(queued()).toHaveLength(2);
    });

    it('warns once per quiet window about a notified event in play with no notification for its league\'s window', async () => {
      const nfl = league();
      const quiet = liveEvent(nfl.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(20)), playedAsField: false }] });
      const { tick, logger, advance } = tickOf({ leagues: [nfl], live: [quiet], schedule: scoresOnly, cadence: cadence() });
      const warnings = (): unknown[][] => logger.warn.mock.calls.filter(([fields]) => (fields as { action?: string }).action === 'ingestion.providerNotifications.quiet');

      await tick.tick();
      advance(minutes(1));
      await tick.tick();

      expect(warnings()).toHaveLength(1);
    });

    it('takes each league\'s own quiet window, and never warns about an event whose provider sends no notifications', async () => {
      const pga = league({ selectedProviderMapping: buildProviderMapping({ id: randomUUID(), providerLeagueId: PGA_PROVIDER_LEAGUE, providerLeagueCode: 'pga' }) });
      const round = liveEvent(pga.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(20)), playedAsField: true }] });
      const notified = tickOf({ leagues: [pga], live: [round], schedule: scoresOnly, cadence: cadence() });
      const unnotified = tickOf({ leagues: [league()], live: [liveEvent(randomUUID())], schedule: scoresOnly });

      await notified.tick.tick();
      await unnotified.tick.tick();

      expect(notified.logger.warn).not.toHaveBeenCalled();
      expect(unnotified.logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('the quiet live scores finding (#2094)', () => {
    const scoresOnly = { ...SCHEDULE, EVENTS: { enabled: false, intervalMinutes: 360 } };
    const raisedEvents = (findings: { raiseOfSource: jest.Mock }) => findings.raiseOfSource.mock.calls.flatMap(([, raises]) => (raises as { sportEventId: string }[]).map((raise) => raise.sportEventId));

    it('raises nothing for an event in play whose scores have been quiet for less than its league\'s window, as between scoring plays', async () => {
      const nfl = league();
      const live = liveEvent(nfl.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(45)), playedAsField: false }], lastScoresChangedAt: at(-minutes(10)) });
      const { tick, findings } = tickOf({ leagues: [nfl], live: [live], schedule: scoresOnly });

      await tick.tick();

      expect(findings.raiseOfSource).not.toHaveBeenCalled();
    });

    it('raises a WARNING on the event under its provider once its scores have been quiet past its league\'s window, and not again on the next tick', async () => {
      const nfl = league();
      const live = liveEvent(nfl.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(45)), playedAsField: false }], lastScoresChangedAt: at(-minutes(20)) });
      const { tick, findings, advance } = tickOf({ leagues: [nfl], live: [live], schedule: scoresOnly });

      await tick.tick();
      advance(minutes(1));
      await tick.tick();

      expect(findings.raiseOfSource).toHaveBeenCalledTimes(1);
      expect(findings.raiseOfSource).toHaveBeenCalledWith(nfl.selectedProviderMapping?.providerId, [{
        kind: 'NO_PROVIDER_LIVE_SCORES', severity: 'WARNING', sportLeagueId: nfl.id, sportEventId: live.sportEventId, providerValue: null, providerValueName: null,
      }]);
    });

    it('still queues the scores sync and logs the failure when raising No live scores fails', async () => {
      const nfl = league();
      const live = liveEvent(nfl.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(45)), playedAsField: false }], lastScoresChangedAt: at(-minutes(20)) });
      const { tick, findings, logger, queued } = tickOf({ leagues: [nfl], live: [live], schedule: scoresOnly });
      findings.raiseOfSource.mockRejectedValueOnce(new Error('findings write failed'));

      await tick.tick();

      expect(queued()).toContainEqual({ type: BackgroundJobType.SYNC_EVENT_SCORES, sportLeagueId: undefined, sportEventId: live.sportEventId });
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'ingestion.syncFinding.quietLiveScoresFailed' }), expect.any(String));
    });

    it('counts quiet from when play got under way when the scores never changed, and from a later notification when there was one', async () => {
      const nfl = league();
      const neverChanged = liveEvent(nfl.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(20)), playedAsField: false }] });
      const heardLately = liveEvent(nfl.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(60)), playedAsField: false }], lastHeardAt: at(-minutes(5)) });
      const { tick, findings } = tickOf({ leagues: [nfl], live: [neverChanged, heardLately], schedule: scoresOnly });

      await tick.tick();

      expect(raisedEvents(findings)).toEqual([neverChanged.sportEventId]);
    });

    it('takes each provider league\'s own window: a golf round quiet for an hour raises nothing', async () => {
      const pga = league({ selectedProviderMapping: buildProviderMapping({ id: randomUUID(), providerLeagueId: PGA_PROVIDER_LEAGUE, providerLeagueCode: 'pga' }) });
      const round = liveEvent(pga.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(60)), playedAsField: true }] });
      const { tick, findings } = tickOf({ leagues: [pga], live: [round], schedule: scoresOnly });

      await tick.tick();

      expect(findings.raiseOfSource).not.toHaveBeenCalled();
    });

    it('raises nothing for an event with no Game under way yet, nor while live score syncs are off', async () => {
      const nfl = league();
      const notStarted = liveEvent(nfl.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: null, playedAsField: false }] });
      const quiet = liveEvent(nfl.id, { games: [{ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(20)), playedAsField: false }] });
      const started = tickOf({ leagues: [nfl], live: [notStarted], schedule: scoresOnly });
      const off = tickOf({ leagues: [nfl], live: [quiet], schedule: { ...scoresOnly, SCORES: { enabled: false, intervalSeconds: 300 } } });

      await started.tick.tick();
      await off.tick.tick();

      expect(started.findings.raiseOfSource).not.toHaveBeenCalled();
      expect(off.findings.raiseOfSource).not.toHaveBeenCalled();
    });
  });
});
