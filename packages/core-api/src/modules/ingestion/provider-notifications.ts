/**
 * Provider notifications (#1498): a provider's webhook saying something happened in a game or
 * an event. A notification is a trigger, never a record: it queues a SYNC_EVENT_SCORES job for
 * each linked event it is about (#2009), the job the sync tick queues too, and the job reads the
 * event's current scores over REST.
 *
 * Bursts coalesce: each event's job is due a short while out under a dedupe key, so every
 * notification that arrives while it waits queues nothing. The key is released when a worker
 * claims the job, so a notification during or after the sync queues the next one.
 *
 * #1499 adds three things. Play starting also finds the events still SCHEDULED past their start,
 * whose sync waits until the lifecycle sweep has moved them in progress (a live score is written
 * only then). Play ending queues a second, reconciling sync a while later, for the corrections a
 * provider makes after the final whistle. And every notification records when it arrived on the
 * Games it is about, so the sync tick can tell when an event in play has gone quiet.
 *
 * A game's notification routes by its game id alone (#2007): the id's Game provider mapping names
 * the one Game, and so the one event, it is about. Its arrival is recorded on that Game. An id no
 * Game is mapped to queues nothing and is a GAME_UNKNOWN finding on the league the provider sent
 * it for; nothing is synced on a guess.
 *
 * An event's own notification, such as a golf round starting, routes through the event's provider
 * mapping (#2008), and its arrival is recorded on the event's Games in play: a golf tournament's
 * current round. An event keeps no notification time of its own.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ProviderNotifiedEvent, SportEventRepository, SportEventRoundMatchGameRepository, SportLeagueRepository } from '@poolmaster/shared/db';
import { ProviderSyncFindingKind, ProviderSyncFindingSeverity, ProviderSyncKind, requireProviderCodeOfSourceId, type Sport } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { ProviderSyncFindingService } from './findings/provider-sync-finding-service';
import { WEBHOOK_START } from '../../core/job-start';
import { eventSyncJob, EventSyncWait } from './event-sync-job-requests';

/** Where in play a notification falls: play starting, under way, or ended. */
export type ProviderNotificationPhase = 'START' | 'PROGRESS' | 'END';

/** What a notification is about, once the provider's adapter has read it. */
export type ProviderNotification = {
  providerId: string;
  sport: Sport;
  /** The provider's own name for what happened, for the log. */
  notificationType: string;
  phase: ProviderNotificationPhase;
} & (
  /**
   * A game's notification: the Game its id is mapped to is the one it is about (#2007). The
   * provider's league `providerLeagueCode` names the league an unknown id is raised on.
   */
  | { subject: 'GAME'; gameId: string; providerLeagueCode: string }
  /** An event's own notification, such as a golf round starting. */
  | { subject: 'EVENT'; eventId: string }
);

/** How long a notified event's sync waits for the rest of a burst, by default. */
export const PROVIDER_NOTIFICATION_COALESCE_MS = 60_000;

/**
 * How long the sync of an event still SCHEDULED when play started waits, by default: one event
 * lifecycle sweep (every 5 minutes) and a minute more, so the event is in progress when it runs.
 */
export const PROVIDER_NOTIFICATION_STARTING_SYNC_DELAY_MS = 6 * 60_000;

/** How long after play ends the reconciling sync runs, by default. */
export const PROVIDER_NOTIFICATION_RECONCILE_DELAY_MS = 10 * 60_000;

export interface ProviderNotificationOutcome {
  /** The linked events the notification is about. */
  events: number;
  /** The syncs it queued, reconciling ones included: fewer where one was already waiting. */
  queued: number;
}

export interface ProviderNotificationServiceDependencies {
  sportEvents: Pick<SportEventRepository, 'findLiveNotifiedEvents'>;
  games: Pick<SportEventRoundMatchGameRepository, 'findByProviderExternalIds' | 'recordProviderNotification' | 'recordEventNotification'>;
  /** The synced leagues, to raise an unknown game's finding on the league the provider sent it for. */
  sportLeagues: Pick<SportLeagueRepository, 'findEventSynced'>;
  findings: Pick<ProviderSyncFindingService, 'raiseOfSource'>;
  jobs: Pick<BackgroundJobQueue, 'request' | 'enqueueAll'>;
  /** How long a sync waits for the rest of a burst; PROVIDER_NOTIFICATION_COALESCE_MS by default. */
  coalesceMs?: number;
  /** PROVIDER_NOTIFICATION_STARTING_SYNC_DELAY_MS by default. */
  startingSyncDelayMs?: number;
  /** PROVIDER_NOTIFICATION_RECONCILE_DELAY_MS by default. */
  reconcileDelayMs?: number;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export class ProviderNotificationService {
  private readonly coalesceMs: number;
  private readonly startingSyncDelayMs: number;
  private readonly reconcileDelayMs: number;

  constructor(private readonly deps: ProviderNotificationServiceDependencies) {
    this.coalesceMs = deps.coalesceMs ?? PROVIDER_NOTIFICATION_COALESCE_MS;
    this.startingSyncDelayMs = deps.startingSyncDelayMs ?? PROVIDER_NOTIFICATION_STARTING_SYNC_DELAY_MS;
    this.reconcileDelayMs = deps.reconcileDelayMs ?? PROVIDER_NOTIFICATION_RECONCILE_DELAY_MS;
  }

  /**
   * Queues one sync for each linked, in-progress event the notification is about: an event's own
   * notification syncs that event, and a game's the event of the Game its id is mapped to. A
   * notification about nothing linked queues nothing.
   */
  async receive(notification: ProviderNotification): Promise<ProviderNotificationOutcome> {
    const now = this.deps.now?.() ?? new Date();
    const events = await this.notifiedEvents(notification, now);
    const after = (ms: number) => new Date(now.getTime() + ms);
    const scoresJob = (event: ProviderNotifiedEvent, runAt: Date, wait: EventSyncWait) => eventSyncJob(
      this.deps.jobs,
      ProviderSyncKind.SCORES,
      { sportEventId: event.sportEventId },
      { runAt, wait, start: WEBHOOK_START, providerCode: requireProviderCodeOfSourceId(event.providerId) },
    );
    const syncs = events.map((event) => scoresJob(event, after(event.inProgress ? this.coalesceMs : this.startingSyncDelayMs), EventSyncWait.SYNC));
    const reconciles = notification.phase !== 'END' ? [] : events.map((event) => scoresJob(event, after(this.reconcileDelayMs), EventSyncWait.RECONCILE));
    // poolmaster-allow-direct-job: the webhook's syncs, in one write
    const queued = await this.deps.jobs.enqueueAll([...syncs, ...reconciles]);
    this.deps.logger?.debug({
      action: 'ingestion.providerNotification.received',
      data: {
        providerId: notification.providerId,
        notificationType: notification.notificationType,
        phase: notification.phase,
        subject: notification.subject,
        events: events.map((event) => event.externalId),
        queued,
      },
    }, events.length === 0
      ? 'A provider notification is about no linked event in play; nothing to sync'
      : 'Queued syncs for the events a provider notification is about');
    return { events: events.length, queued };
  }

  private async notifiedEvents(notification: ProviderNotification, now: Date): Promise<ProviderNotifiedEvent[]> {
    const { providerId, sport } = notification;
    const startedBy = notification.phase === 'START' ? { startedBy: now } : {};
    if (notification.subject === 'EVENT') {
      const events = await this.deps.sportEvents.findLiveNotifiedEvents({ providerId, sport, externalId: notification.eventId, ...startedBy });
      // Found through the event's provider mapping, its arrival is its Games' in play: a golf
      // tournament's current round (#2008), the Game the quiet check reads.
      await this.deps.games.recordEventNotification([...new Set(events.map((event) => event.sportEventId))], now);
      return events;
    }
    const games = await this.deps.games.findByProviderExternalIds(requireProviderCodeOfSourceId(providerId), [notification.gameId]);
    if (games.length === 0) {
      await this.raiseUnknownGame(notification);
      return [];
    }
    await this.deps.games.recordProviderNotification(games.map(({ game }) => game.id), now);
    return this.deps.sportEvents.findLiveNotifiedEvents({ providerId, sport, sportEventIds: [...new Set(games.map(({ game }) => game.sportEventId))], ...startedBy });
  }

  /**
   * A GAME_UNKNOWN finding on each league synced from the provider's league the notification names.
   * The notification is answered either way: a finding that fails to raise is logged.
   */
  private async raiseUnknownGame(notification: Extract<ProviderNotification, { subject: 'GAME' }>): Promise<void> {
    try {
      const leagues = (await this.deps.sportLeagues.findEventSynced()).filter((league) => league.selectedProviderMapping?.providerId === notification.providerId
        && league.selectedProviderMapping.providerLeagueCode === notification.providerLeagueCode);
      await this.deps.findings.raiseOfSource(notification.providerId, leagues.map((league) => ({
        kind: ProviderSyncFindingKind.GAME_UNKNOWN,
        severity: ProviderSyncFindingSeverity.WARNING,
        sportLeagueId: league.id,
        sportEventId: null,
        providerValue: notification.gameId,
        providerValueName: null,
      })));
    } catch (err) {
      this.deps.logger?.error(
        { action: 'ingestion.syncFinding.raiseFailed', err, providerId: notification.providerId, gameId: notification.gameId },
        'Raising an unknown game\'s finding failed; the notification was answered',
      );
    }
  }
}
