import { BackgroundJobType, MatchStatus, ProviderSyncFindingKind, ProviderSyncFindingSeverity, Sport, type SportLeague, HomeAway } from '@poolmaster/shared/domain';
import type { ProviderMappedGame, ProviderNotificationReceipt, ProviderNotifiedEvent, ProviderNotifiedEventQuery } from '@poolmaster/shared/db';
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
import { inMemoryBackgroundJobs, testCurrentJobStart } from '../../support/in-memory-background-jobs';
import { fakeLogger } from '../../support/fake-logger';

const NOW = new Date('2026-11-15T18:00:00.000Z');

const nflPeriodEnded: ProviderNotification = {
  providerId: 'balldontlie',
  sport: Sport.FOOTBALL,
  notificationType: 'nfl.game.period_ended',
  phase: 'PROGRESS',
  subject: 'GAME',
  gameId: '424095',
  providerLeagueCode: 'nfl',
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

/** PoolMaster's id for every notified event here; the job carries it as its Activity scope. */
const LIVE_EVENT_ID = '7f3c2a10-1b4e-4c55-9a77-3e2f8d0c1a01';

function liveEvent(externalId: string, sport: Sport, inProgress = true): ProviderNotifiedEvent {
  return { sportEventId: LIVE_EVENT_ID, sport, providerId: 'balldontlie', externalId, inProgress };
}

/** The Game the provider's game id `424095` is mapped to, in the live event. */
const MAPPED_GAME: ProviderMappedGame = {
  externalId: '424095',
  game: {
    id: 'game-1', sportEventId: LIVE_EVENT_ID, sportEventRoundMatchId: 'match-1', sportEventSlotId: 'event-slot-1', gameNumber: 1,
    scheduledDate: null, status: MatchStatus.IN_PROGRESS, completedAt: null,
    movedToGameId: null, lastProviderNotificationAt: null, createdAt: NOW, updatedAt: NOW,
    sideResults: [
      { sportEventRoundMatchSideId: 'match-1-s1', sideNumber: 1, score: 3, homeAway: HomeAway.AWAY, periodScores: [] },
      { sportEventRoundMatchSideId: 'match-1-s2', sideNumber: 2, score: 7, homeAway: HomeAway.HOME, periodScores: [] },
    ],
  },
};

/** Two synced leagues: the NFL, synced from the provider's `nfl`, and one from another of its leagues. */
const SYNCED_LEAGUES = [
  { id: 'league-nfl', selectedProviderMapping: { providerId: 'balldontlie', providerLeagueCode: 'nfl' } },
  { id: 'league-nba', selectedProviderMapping: { providerId: 'balldontlie', providerLeagueCode: 'nba' } },
] as unknown as SportLeague[];

function setup(
  live: ProviderNotifiedEvent[],
  delays: { coalesceMs?: number; startingSyncDelayMs?: number; reconcileDelayMs?: number } = {},
  mapped: readonly ProviderMappedGame[] = [MAPPED_GAME],
) {
  const jobs = inMemoryBackgroundJobs(() => NOW);
  const queue = new BackgroundJobQueue({ jobs, currentStart: testCurrentJobStart });
  const findLiveNotifiedEvents = jest.fn((_query: ProviderNotifiedEventQuery) => Promise.resolve(live));
  const recordProviderNotification = jest.fn((_receipt: ProviderNotificationReceipt) => Promise.resolve());
  const findByProviderExternalIds = jest.fn((_code: string, ids: readonly string[]) => Promise.resolve(mapped.filter((each) => each.externalId !== null && ids.includes(each.externalId))));
  const recordGameNotification = jest.fn((_gameIds: readonly string[], _at: Date) => Promise.resolve());
  const raiseOfSource = jest.fn((_providerId: string, _raises: readonly unknown[]) => Promise.resolve());
  const service = new ProviderNotificationService({
    sportEvents: { findLiveNotifiedEvents, recordProviderNotification },
    games: { findByProviderExternalIds, recordProviderNotification: recordGameNotification },
    sportLeagues: { findEventSynced: async () => SYNCED_LEAGUES },
    findings: { raiseOfSource },
    jobs: queue,
    now: () => NOW,
    ...delays,
    logger: fakeLogger(),
  });
  return { jobs, service, findLiveNotifiedEvents, recordProviderNotification, findByProviderExternalIds, recordGameNotification, raiseOfSource };
}

describe('provider notifications (#1498)', () => {
  it('queues one live-score sync of the event holding the Game the notified game id is mapped to, due a minute out under its event key', async () => {
    const { jobs, service, findLiveNotifiedEvents, findByProviderExternalIds } = setup([liveEvent('nfl-2026-week-11', Sport.FOOTBALL)]);

    await expect(service.receive(nflPeriodEnded)).resolves.toEqual({ events: 1, queued: 1 });

    expect(findByProviderExternalIds).toHaveBeenCalledWith('BALLDONTLIE', ['424095']);
    expect(findLiveNotifiedEvents).toHaveBeenCalledWith({ providerId: 'balldontlie', sport: Sport.FOOTBALL, sportEventIds: [LIVE_EVENT_ID] });
    expect(jobs.rows).toEqual([expect.objectContaining({
      type: BackgroundJobType.PROVIDER_EVENT_SYNC,
      payload: { sport: Sport.FOOTBALL, providerId: 'balldontlie', eventId: 'nfl-2026-week-11', sportEventId: LIVE_EVENT_ID },
      sportEventId: LIVE_EVENT_ID,
      runAt: new Date(NOW.getTime() + PROVIDER_NOTIFICATION_COALESCE_MS),
      dedupeKey: 'provider-event-sync:balldontlie:nfl-2026-week-11',
    })]);
  });

  it('syncs nothing for a game id no Game is mapped to, never every live event of its league, and raises a GAME_UNKNOWN finding on the league it was sent for', async () => {
    const { jobs, service, findLiveNotifiedEvents, raiseOfSource } = setup([
      liveEvent('nfl-2026-week-11', Sport.FOOTBALL),
      liveEvent('nfl-2026-postseason', Sport.FOOTBALL),
    ], {}, []);

    await expect(service.receive(nflPeriodEnded)).resolves.toEqual({ events: 0, queued: 0 });

    expect(jobs.rows).toHaveLength(0);
    expect(findLiveNotifiedEvents).not.toHaveBeenCalled();
    expect(raiseOfSource).toHaveBeenCalledWith('balldontlie', [{
      kind: ProviderSyncFindingKind.GAME_UNKNOWN,
      severity: ProviderSyncFindingSeverity.WARNING,
      sportLeagueId: 'league-nfl',
      sportEventId: null,
      providerValue: '424095',
      providerValueName: null,
    }]);
  });

  it('answers an unknown game\'s notification even when its finding cannot be raised', async () => {
    const { service, raiseOfSource } = setup([], {}, []);
    raiseOfSource.mockRejectedValue(new Error('connection reset'));

    await expect(service.receive(nflPeriodEnded)).resolves.toEqual({ events: 0, queued: 0 });
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
    const { jobs, service } = setup([liveEvent('nfl-2026-week-11', Sport.FOOTBALL)]);

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
      liveEvent('nfl-2026-week-11', Sport.FOOTBALL, false),
    ]);

    await expect(service.receive({ ...nflPeriodEnded, notificationType: 'nfl.game.started', phase: 'START' })).resolves.toEqual({ events: 1, queued: 1 });

    expect(findLiveNotifiedEvents).toHaveBeenCalledWith(expect.objectContaining({ startedBy: NOW, sportEventIds: [LIVE_EVENT_ID] }));
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
    const { jobs, service } = setup([liveEvent('nfl-2026-week-11', Sport.FOOTBALL)]);

    await expect(service.receive(nflGameEnded)).resolves.toEqual({ events: 1, queued: 2 });
    await expect(service.receive(nflGameEnded)).resolves.toEqual({ events: 1, queued: 0 });

    expect(jobs.rows).toEqual([
      expect.objectContaining({
        runAt: new Date(NOW.getTime() + PROVIDER_NOTIFICATION_COALESCE_MS),
        dedupeKey: 'provider-event-sync:balldontlie:nfl-2026-week-11',
      }),
      expect.objectContaining({
        type: BackgroundJobType.PROVIDER_EVENT_SYNC,
        payload: { sport: Sport.FOOTBALL, providerId: 'balldontlie', eventId: 'nfl-2026-week-11', sportEventId: LIVE_EVENT_ID },
        sportEventId: LIVE_EVENT_ID,
        runAt: new Date(NOW.getTime() + PROVIDER_NOTIFICATION_RECONCILE_DELAY_MS),
        dedupeKey: 'provider-event-reconcile:balldontlie:nfl-2026-week-11',
      }),
    ]);
  });

  it('waits the configured delays for a starting event\'s sync and a reconciling sync', async () => {
    const starting = setup([liveEvent('1133', Sport.GOLF, false)], { startingSyncDelayMs: 7_000 });
    await starting.service.receive(golfRoundStarted);
    expect(starting.jobs.rows[0]?.runAt).toEqual(new Date(NOW.getTime() + 7_000));

    const ending = setup([liveEvent('1133', Sport.GOLF)], { reconcileDelayMs: 9_000 });
    await ending.service.receive({ ...golfRoundStarted, notificationType: 'pga.tournament.ended', phase: 'END' });
    expect(ending.jobs.rows.map((row) => row.runAt)).toEqual([
      new Date(NOW.getTime() + PROVIDER_NOTIFICATION_COALESCE_MS),
      new Date(NOW.getTime() + 9_000),
    ]);
  });

  it('records when a game\'s notification arrived on the Game it is about, and an event\'s own notification on its event, so a quiet one can be told apart', async () => {
    const game = setup([liveEvent('nfl-2026-week-11', Sport.FOOTBALL)]);
    await game.service.receive(nflPeriodEnded);
    expect(game.recordGameNotification).toHaveBeenCalledWith(['game-1'], NOW);
    expect(game.recordProviderNotification).not.toHaveBeenCalled();

    const golf = setup([liveEvent('1133', Sport.GOLF)]);
    await golf.service.receive(golfRoundStarted);
    expect(golf.recordProviderNotification).toHaveBeenCalledWith({ providerId: 'balldontlie', externalIds: ['1133'], receivedAt: NOW });
    expect(golf.recordGameNotification).not.toHaveBeenCalled();
  });

  it('keys an event\'s reconciling sync apart from its coalesced one, hashing an id too long for the column', () => {
    const event = { providerId: 'balldontlie', externalId: 'nfl-2026-week-11' };
    expect(providerEventReconcileKey(event)).not.toBe(providerEventSyncKey(event));
    expect(providerEventReconcileKey({ providerId: 'balldontlie', externalId: 'x'.repeat(250) })).toMatch(/^provider-event-reconcile:sha256:[0-9a-f]{64}$/);
  });
});
