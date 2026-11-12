import { BackgroundJobType, Sport } from '@poolmaster/shared/domain';
import type { ProviderNotificationReceipt, ProviderNotifiedEvent, ProviderNotifiedEventQuery } from '@poolmaster/shared/db';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import {
  PROVIDER_NOTIFICATION_COALESCE_MS,
  PROVIDER_NOTIFICATION_RECONCILE_DELAY_MS,
  PROVIDER_NOTIFICATION_STARTING_SYNC_DELAY_MS,
  ProviderNotificationService,
  providerEventReconcileKey,
  providerEventSyncKey,
  type ProviderNotification,
} from '../../../packages/core-api/src/modules/ingestion/provider-notifications';
import { inMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';
import { fakeLogger } from '../../support/fake-logger';

const NOW = new Date('2026-11-15T18:00:00.000Z');

const nflPeriodEnded: ProviderNotification = {
  providerId: 'balldontlie',
  sport: Sport.AMERICAN_FOOTBALL,
  notificationType: 'nfl.game.period_ended',
  phase: 'PROGRESS',
  subject: 'GAME',
  gameId: '424095',
  eventIdPrefix: 'nfl-',
};

const golfRoundStarted: ProviderNotification = {
  providerId: 'balldontlie',
  sport: Sport.GOLF,
  notificationType: 'pga.tournament.round_started',
  phase: 'START',
  subject: 'EVENT',
  eventId: '1133',
};

const nflGameEnded: ProviderNotification = { ...nflPeriodEnded, notificationType: 'nfl.game.ended', phase: 'END' };

function liveEvent(externalId: string, sport: Sport, holdsGame = false, inProgress = true): ProviderNotifiedEvent {
  return { sport, providerId: 'balldontlie', externalId, holdsGame, inProgress };
}

function setup(
  live: ProviderNotifiedEvent[],
  delays: { coalesceMs?: number; startingSyncDelayMs?: number; reconcileDelayMs?: number } = {},
) {
  const jobs = inMemoryBackgroundJobs(() => NOW);
  const queue = new BackgroundJobQueue({ jobs });
  const findLiveNotifiedEvents = jest.fn((_query: ProviderNotifiedEventQuery) => Promise.resolve(live));
  const recordProviderNotification = jest.fn((_receipt: ProviderNotificationReceipt) => Promise.resolve());
  const service = new ProviderNotificationService({
    sportEvents: { findLiveNotifiedEvents, recordProviderNotification },
    jobs: queue,
    now: () => NOW,
    ...delays,
    logger: fakeLogger(),
  });
  return { jobs, service, findLiveNotifiedEvents, recordProviderNotification };
}

describe('provider notifications (#1498)', () => {
  it('queues one live-score sync of the event whose match is linked to the notified game, due a minute out under its event key', async () => {
    const { jobs, service, findLiveNotifiedEvents } = setup([
      liveEvent('nfl-2026-week-11', Sport.AMERICAN_FOOTBALL, true),
      liveEvent('nfl-2026-postseason', Sport.AMERICAN_FOOTBALL),
    ]);

    await expect(service.receive(nflPeriodEnded)).resolves.toEqual({ events: 1, queued: 1 });

    expect(findLiveNotifiedEvents).toHaveBeenCalledWith({
      providerId: 'balldontlie',
      sport: Sport.AMERICAN_FOOTBALL,
      externalIdPrefix: 'nfl-',
      gameId: '424095',
    });
    expect(jobs.rows).toEqual([expect.objectContaining({
      type: BackgroundJobType.PROVIDER_EVENT_SYNC,
      payload: { sport: Sport.AMERICAN_FOOTBALL, providerId: 'balldontlie', eventId: 'nfl-2026-week-11' },
      runAt: new Date(NOW.getTime() + PROVIDER_NOTIFICATION_COALESCE_MS),
      dedupeKey: 'provider-event-sync:balldontlie:nfl-2026-week-11',
    })]);
  });

  it('syncs every in-progress event of the game\'s league while no match is linked to the game yet, such as a playoff series', async () => {
    const { jobs, service } = setup([
      liveEvent('nfl-2026-week-11', Sport.AMERICAN_FOOTBALL),
      liveEvent('nfl-2026-postseason', Sport.AMERICAN_FOOTBALL),
    ]);

    await expect(service.receive(nflPeriodEnded)).resolves.toEqual({ events: 2, queued: 2 });

    expect(jobs.rows.map((row) => row.dedupeKey)).toEqual([
      'provider-event-sync:balldontlie:nfl-2026-week-11',
      'provider-event-sync:balldontlie:nfl-2026-postseason',
    ]);
  });

  it('looks a golf notification\'s event up by the tournament id it names', async () => {
    const { jobs, service, findLiveNotifiedEvents } = setup([liveEvent('1133', Sport.GOLF)]);

    await expect(service.receive(golfRoundStarted)).resolves.toEqual({ events: 1, queued: 1 });

    expect(findLiveNotifiedEvents).toHaveBeenCalledWith({ providerId: 'balldontlie', sport: Sport.GOLF, externalId: '1133', startedBy: NOW });
    expect(jobs.rows).toHaveLength(1);
  });

  it('acknowledges a notification about nothing linked and in play by queueing nothing', async () => {
    const { jobs, service } = setup([]);

    await expect(service.receive(nflPeriodEnded)).resolves.toEqual({ events: 0, queued: 0 });

    expect(jobs.rows).toHaveLength(0);
  });

  it('coalesces a burst and a duplicate delivery into the one sync already waiting for the event', async () => {
    const { jobs, service } = setup([liveEvent('nfl-2026-week-11', Sport.AMERICAN_FOOTBALL, true)]);

    await service.receive(nflPeriodEnded);
    await expect(service.receive(nflPeriodEnded)).resolves.toEqual({ events: 1, queued: 0 });
    await expect(service.receive({ ...nflPeriodEnded, notificationType: 'nfl.game.halftime' })).resolves.toEqual({ events: 1, queued: 0 });

    expect(jobs.rows).toHaveLength(1);
  });

  it('waits the configured coalescing window before the sync is due', async () => {
    const { jobs, service } = setup([liveEvent('1133', Sport.GOLF)], { coalesceMs: 5_000 });

    await service.receive(golfRoundStarted);

    expect(jobs.rows[0]?.runAt).toEqual(new Date(NOW.getTime() + 5_000));
  });

  it('keys an event whose id is too long for the dedupe column by a hash of its provider and id, still one key per event', () => {
    const longId = 'x'.repeat(250);

    const key = providerEventSyncKey({ providerId: 'balldontlie', externalId: longId });

    expect(key).toMatch(/^provider-event-sync:sha256:[0-9a-f]{64}$/);
    expect(providerEventSyncKey({ providerId: 'balldontlie', externalId: longId })).toBe(key);
    expect(providerEventSyncKey({ providerId: 'balldontlie', externalId: `${longId}y` })).not.toBe(key);
  });
});

describe('provider notifications as play starts and ends (#1499)', () => {
  it('also finds the events still SCHEDULED past their start when play starts, and waits for the lifecycle sweep before syncing one', async () => {
    const { jobs, service, findLiveNotifiedEvents } = setup([
      liveEvent('nfl-2026-week-11', Sport.AMERICAN_FOOTBALL, true, false),
    ]);

    await expect(service.receive({ ...nflPeriodEnded, notificationType: 'nfl.game.started', phase: 'START' })).resolves.toEqual({ events: 1, queued: 1 });

    expect(findLiveNotifiedEvents).toHaveBeenCalledWith(expect.objectContaining({ startedBy: NOW, gameId: '424095' }));
    expect(jobs.rows).toEqual([expect.objectContaining({
      runAt: new Date(NOW.getTime() + PROVIDER_NOTIFICATION_STARTING_SYNC_DELAY_MS),
      dedupeKey: 'provider-event-sync:balldontlie:nfl-2026-week-11',
    })]);
  });

  it('syncs an event already in progress a minute after play starts, like any other notification', async () => {
    const { jobs, service } = setup([liveEvent('1133', Sport.GOLF)]);

    await service.receive(golfRoundStarted);

    expect(jobs.rows[0]?.runAt).toEqual(new Date(NOW.getTime() + PROVIDER_NOTIFICATION_COALESCE_MS));
  });

  it('looks for in-progress events only while play is under way or has ended', async () => {
    const { service, findLiveNotifiedEvents } = setup([]);

    await service.receive(nflPeriodEnded);
    await service.receive(nflGameEnded);

    for (const [query] of findLiveNotifiedEvents.mock.calls) {
      expect(query).not.toHaveProperty('startedBy');
    }
  });

  it('queues a reconciling sync ten minutes after play ends, beside the coalesced one, once per event however often the end is sent', async () => {
    const { jobs, service } = setup([liveEvent('nfl-2026-week-11', Sport.AMERICAN_FOOTBALL, true)]);

    await expect(service.receive(nflGameEnded)).resolves.toEqual({ events: 1, queued: 2 });
    await expect(service.receive(nflGameEnded)).resolves.toEqual({ events: 1, queued: 0 });

    expect(jobs.rows).toEqual([
      expect.objectContaining({
        runAt: new Date(NOW.getTime() + PROVIDER_NOTIFICATION_COALESCE_MS),
        dedupeKey: 'provider-event-sync:balldontlie:nfl-2026-week-11',
      }),
      expect.objectContaining({
        type: BackgroundJobType.PROVIDER_EVENT_SYNC,
        payload: { sport: Sport.AMERICAN_FOOTBALL, providerId: 'balldontlie', eventId: 'nfl-2026-week-11' },
        runAt: new Date(NOW.getTime() + PROVIDER_NOTIFICATION_RECONCILE_DELAY_MS),
        dedupeKey: 'provider-event-reconcile:balldontlie:nfl-2026-week-11',
      }),
    ]);
  });

  it('waits the configured delays for a starting event\'s sync and a reconciling sync', async () => {
    const starting = setup([liveEvent('1133', Sport.GOLF, false, false)], { startingSyncDelayMs: 7_000 });
    await starting.service.receive(golfRoundStarted);
    expect(starting.jobs.rows[0]?.runAt).toEqual(new Date(NOW.getTime() + 7_000));

    const ending = setup([liveEvent('1133', Sport.GOLF)], { reconcileDelayMs: 9_000 });
    await ending.service.receive({ ...golfRoundStarted, notificationType: 'pga.tournament.ended', phase: 'END' });
    expect(ending.jobs.rows.map((row) => row.runAt)).toEqual([
      new Date(NOW.getTime() + PROVIDER_NOTIFICATION_COALESCE_MS),
      new Date(NOW.getTime() + 9_000),
    ]);
  });

  it('records when the notification arrived on every event it is about, so a quiet event can be told apart', async () => {
    const { service, recordProviderNotification } = setup([
      liveEvent('nfl-2026-week-11', Sport.AMERICAN_FOOTBALL),
      liveEvent('nfl-2026-postseason', Sport.AMERICAN_FOOTBALL),
    ]);

    await service.receive(nflPeriodEnded);

    expect(recordProviderNotification).toHaveBeenCalledWith({
      providerId: 'balldontlie',
      externalIds: ['nfl-2026-week-11', 'nfl-2026-postseason'],
      receivedAt: NOW,
    });
  });

  it('keys an event\'s reconciling sync apart from its coalesced one, hashing an id too long for the column', () => {
    const event = { providerId: 'balldontlie', externalId: 'nfl-2026-week-11' };
    expect(providerEventReconcileKey(event)).not.toBe(providerEventSyncKey(event));
    expect(providerEventReconcileKey({ providerId: 'balldontlie', externalId: 'x'.repeat(250) })).toMatch(/^provider-event-reconcile:sha256:[0-9a-f]{64}$/);
  });
});
