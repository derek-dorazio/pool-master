import { BackgroundJobType, Sport } from '@poolmaster/shared/domain';
import type { ProviderNotifiedEvent, ProviderNotifiedEventQuery } from '@poolmaster/shared/db';
import { BackgroundJobQueue } from '../../../packages/core-api/src/modules/background-jobs';
import {
  PROVIDER_NOTIFICATION_COALESCE_MS,
  ProviderNotificationService,
  providerEventSyncKey,
  type ProviderNotification,
} from '../../../packages/core-api/src/modules/ingestion/provider-notifications';
import { inMemoryBackgroundJobs } from '../../support/in-memory-background-jobs';
import { fakeLogger } from '../../support/fake-logger';

const NOW = new Date('2026-11-15T18:00:00.000Z');

const nflGameEnded: ProviderNotification = {
  providerId: 'balldontlie',
  sport: Sport.AMERICAN_FOOTBALL,
  notificationType: 'nfl.game.ended',
  subject: 'GAME',
  gameId: '424095',
  eventIdPrefix: 'nfl-',
};

const golfRoundStarted: ProviderNotification = {
  providerId: 'balldontlie',
  sport: Sport.GOLF,
  notificationType: 'pga.tournament.round_started',
  subject: 'EVENT',
  eventId: '1133',
};

function liveEvent(externalId: string, sport: Sport, holdsGame = false): ProviderNotifiedEvent {
  return { sport, providerId: 'balldontlie', externalId, holdsGame };
}

function setup(live: ProviderNotifiedEvent[], coalesceMs?: number) {
  const jobs = inMemoryBackgroundJobs(() => NOW);
  const queue = new BackgroundJobQueue({ jobs });
  const findLiveNotifiedEvents = jest.fn((_query: ProviderNotifiedEventQuery) => Promise.resolve(live));
  const service = new ProviderNotificationService({
    sportEvents: { findLiveNotifiedEvents },
    jobs: queue,
    now: () => NOW,
    coalesceMs,
    logger: fakeLogger(),
  });
  return { jobs, service, findLiveNotifiedEvents };
}

describe('provider notifications (#1498)', () => {
  it('queues one live-score sync of the event whose match is linked to the notified game, due a minute out under its event key', async () => {
    const { jobs, service, findLiveNotifiedEvents } = setup([
      liveEvent('nfl-2026-week-11', Sport.AMERICAN_FOOTBALL, true),
      liveEvent('nfl-2026-postseason', Sport.AMERICAN_FOOTBALL),
    ]);

    await expect(service.receive(nflGameEnded)).resolves.toEqual({ events: 1, queued: 1 });

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

    await expect(service.receive(nflGameEnded)).resolves.toEqual({ events: 2, queued: 2 });

    expect(jobs.rows.map((row) => row.dedupeKey)).toEqual([
      'provider-event-sync:balldontlie:nfl-2026-week-11',
      'provider-event-sync:balldontlie:nfl-2026-postseason',
    ]);
  });

  it('looks a golf notification\'s event up by the tournament id it names', async () => {
    const { jobs, service, findLiveNotifiedEvents } = setup([liveEvent('1133', Sport.GOLF)]);

    await expect(service.receive(golfRoundStarted)).resolves.toEqual({ events: 1, queued: 1 });

    expect(findLiveNotifiedEvents).toHaveBeenCalledWith({ providerId: 'balldontlie', sport: Sport.GOLF, externalId: '1133' });
    expect(jobs.rows).toHaveLength(1);
  });

  it('acknowledges a notification about nothing linked and in progress by queueing nothing', async () => {
    const { jobs, service } = setup([]);

    await expect(service.receive(nflGameEnded)).resolves.toEqual({ events: 0, queued: 0 });

    expect(jobs.rows).toHaveLength(0);
  });

  it('coalesces a burst and a duplicate delivery into the one sync already waiting for the event', async () => {
    const { jobs, service } = setup([liveEvent('nfl-2026-week-11', Sport.AMERICAN_FOOTBALL, true)]);

    await service.receive(nflGameEnded);
    await expect(service.receive(nflGameEnded)).resolves.toEqual({ events: 1, queued: 0 });
    await expect(service.receive({ ...nflGameEnded, notificationType: 'nfl.game.period_ended' })).resolves.toEqual({ events: 1, queued: 0 });

    expect(jobs.rows).toHaveLength(1);
  });

  it('waits the configured coalescing window before the sync is due', async () => {
    const { jobs, service } = setup([liveEvent('1133', Sport.GOLF)], 5_000);

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
