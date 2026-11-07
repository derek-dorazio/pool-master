/**
 * Each background job type's payload schema (#1439). Exhaustive over the enum, so a new type
 * without a schema fails typecheck; the schema lives with the module whose handler reads it.
 */

import type { z } from 'zod';
import { BackgroundJobType } from '@poolmaster/shared/domain';
import { ManualEventSyncJobPayloadSchema } from '../ingestion/manual-event-sync-job';

export const BACKGROUND_JOB_PAYLOADS = {
  [BackgroundJobType.MANUAL_EVENT_SYNC]: ManualEventSyncJobPayloadSchema,
} as const satisfies Record<BackgroundJobType, z.ZodType>;

/** What a job of type `T` carries. */
export type BackgroundJobPayload<T extends BackgroundJobType> = z.infer<(typeof BACKGROUND_JOB_PAYLOADS)[T]>;
