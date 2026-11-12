/**
 * The PROVIDER_EVENT_SYNC job's payload (#1498): one linked event whose provider said something
 * happened in it (a game started or ended, a round started). The job reads the event's current
 * scores from the provider over REST, so the notification's own contents are never trusted.
 */

import { z } from 'zod';
import { Sport } from '@poolmaster/shared/domain';

export const ProviderEventSyncJobPayloadSchema = z.object({
  sport: z.enum(Sport),
  /** The provider the event is linked to. */
  providerId: z.string().min(1),
  /** The event's id at that provider. */
  eventId: z.string().min(1),
});
export type ProviderEventSyncJobPayload = z.infer<typeof ProviderEventSyncJobPayloadSchema>;
