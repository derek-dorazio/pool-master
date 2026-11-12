/**
 * Provider notifications (#1498): a provider's webhook saying something happened in a game or
 * an event. A notification is a trigger, never a record: it queues a PROVIDER_EVENT_SYNC job for
 * each linked event it is about, and the job reads the event's current scores over REST.
 *
 * Bursts coalesce: each event's job is due a short while out under a dedupe key, so every
 * notification that arrives while it waits queues nothing. The key is released when a worker
 * claims the job, so a notification during or after the sync queues the next one.
 */

import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderNotifiedEvent, SportEventRepository } from '@poolmaster/shared/db';
import { BackgroundJobType, type Sport } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';

/** What a notification is about, once the provider's adapter has read it. */
export type ProviderNotification = {
  providerId: string;
  sport: Sport;
  /** The provider's own name for what happened, for the log. */
  notificationType: string;
} & (
  /** A game's notification: the provider's events whose ids start with `eventIdPrefix` may hold it. */
  | { subject: 'GAME'; gameId: string; eventIdPrefix: string }
  /** An event's own notification, such as a golf round starting. */
  | { subject: 'EVENT'; eventId: string }
);

/** How long a notified event's sync waits for the rest of a burst, by default. */
export const PROVIDER_NOTIFICATION_COALESCE_MS = 60_000;

export interface ProviderNotificationOutcome {
  /** The linked in-progress events the notification is about. */
  events: number;
  /** The syncs it queued: fewer than `events` where one was already waiting. */
  queued: number;
}

export interface ProviderNotificationServiceDependencies {
  sportEvents: Pick<SportEventRepository, 'findLiveNotifiedEvents'>;
  jobs: Pick<BackgroundJobQueue, 'request' | 'enqueueAll'>;
  /** How long a sync waits for the rest of a burst; PROVIDER_NOTIFICATION_COALESCE_MS by default. */
  coalesceMs?: number;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export class ProviderNotificationService {
  private readonly coalesceMs: number;

  constructor(private readonly deps: ProviderNotificationServiceDependencies) {
    this.coalesceMs = deps.coalesceMs ?? PROVIDER_NOTIFICATION_COALESCE_MS;
  }

  /**
   * Queues one sync for each linked, in-progress event the notification is about. A game's
   * notification syncs the event whose match is linked to that game; while no match is, it syncs
   * every in-progress event of the game's league, since a game an event holds is linked only by
   * that event's sync, and a playoff series links none. A notification about nothing linked
   * queues nothing.
   */
  async receive(notification: ProviderNotification): Promise<ProviderNotificationOutcome> {
    const events = await this.notifiedEvents(notification);
    const runAt = new Date((this.deps.now?.() ?? new Date()).getTime() + this.coalesceMs);
    const queued = await this.deps.jobs.enqueueAll(events.map((event) => this.deps.jobs.request(
      BackgroundJobType.PROVIDER_EVENT_SYNC,
      { sport: event.sport, providerId: event.providerId, eventId: event.externalId },
      { runAt, dedupeKey: providerEventSyncKey(event) },
    )));
    this.deps.logger?.debug({
      action: 'ingestion.providerNotification.received',
      data: {
        providerId: notification.providerId,
        notificationType: notification.notificationType,
        subject: notification.subject,
        events: events.map((event) => event.externalId),
        queued,
      },
    }, events.length === 0
      ? 'A provider notification is about no linked in-progress event; nothing to sync'
      : 'Queued syncs for the events a provider notification is about');
    return { events: events.length, queued };
  }

  private async notifiedEvents(notification: ProviderNotification): Promise<ProviderNotifiedEvent[]> {
    const { providerId, sport } = notification;
    if (notification.subject === 'EVENT') {
      return this.deps.sportEvents.findLiveNotifiedEvents({ providerId, sport, externalId: notification.eventId });
    }
    const candidates = await this.deps.sportEvents.findLiveNotifiedEvents({
      providerId,
      sport,
      externalIdPrefix: notification.eventIdPrefix,
      gameId: notification.gameId,
    });
    const holding = candidates.filter((event) => event.holdsGame);
    return holding.length > 0 ? holding : candidates;
  }
}

/** The longest dedupe key a background job can hold (its column's width). */
const DEDUPE_KEY_MAX_LENGTH = 200;

/**
 * One waiting sync per event: the dedupe key a notified event's sync job holds. Readable where it
 * fits the column; an id too long for it is keyed by its hash instead.
 */
export function providerEventSyncKey(event: Pick<ProviderNotifiedEvent, 'providerId' | 'externalId'>): string {
  const key = `provider-event-sync:${event.providerId}:${event.externalId}`;
  return key.length <= DEDUPE_KEY_MAX_LENGTH
    ? key
    : `provider-event-sync:sha256:${createHash('sha256').update(`${event.providerId}:${event.externalId}`).digest('hex')}`;
}
