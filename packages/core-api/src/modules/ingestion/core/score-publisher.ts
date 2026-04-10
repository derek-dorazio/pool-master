/**
 * Score Publisher — transforms ProviderStatEvents into StatEvents
 * and publishes them to the in-process event bus.
 *
 * Called by ingestion callbacks when live scores arrive.
 */

import { randomUUID } from 'node:crypto';
import { eventBus } from '@poolmaster/shared/events/event-bus';
import type { StatEvent } from '@poolmaster/shared/events';
import type { ProviderStatEvent } from './provider-interface';

export async function publishStatEvents(scores: ProviderStatEvent[]): Promise<void> {
  for (const score of scores) {
    const statEvent: StatEvent = {
      id: randomUUID(),
      type: 'stat.received',
      sourceService: 'ingestion-worker',
      timestamp: new Date().toISOString(),
      eventId: score.eventExternalId,
      participantExternalId: score.participantExternalId,
      statKey: score.statKey,
      statValue: score.statValue,
      round: score.round,
      isCorrection: score.isCorrection,
      correctsEventId: score.correctsEventId,
      providerId: score.providerId,
      ingestedAt: new Date().toISOString(),
    };

    await eventBus.publish('stat.received', statEvent);
  }
}
