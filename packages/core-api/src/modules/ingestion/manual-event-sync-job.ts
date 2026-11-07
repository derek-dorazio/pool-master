/**
 * The MANUAL_EVENT_SYNC job's payload (#1441): the sync runs a root admin's event sync submitted,
 * and the event they are for. Each run names its own feed.
 */

import { z } from 'zod';
import { Sport } from '@poolmaster/shared/domain';
import { MockEventStateSchema } from '@poolmaster/shared/dto';

export const ManualEventSyncJobPayloadSchema = z.object({
  syncRunIds: z.array(z.uuid()).min(1),
  sport: z.enum(Sport),
  eventId: z.string().min(1),
  mockEventState: MockEventStateSchema.optional(),
});
export type ManualEventSyncJobPayload = z.infer<typeof ManualEventSyncJobPayloadSchema>;
