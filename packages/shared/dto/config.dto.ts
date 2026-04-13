/**
 * Config DTOs — request/response schemas for client poll guidance and related
 * runtime configuration endpoints.
 */
import { z } from 'zod';

const PollIntervalMsSchema = z.number().int().min(1000).describe(
  'Recommended poll interval in milliseconds.',
);

export const PollIntervalConfigSchema = z.object({
  standings: PollIntervalMsSchema.describe(
    'Recommended refresh interval for standings and leaderboard surfaces.',
  ),
  draft: PollIntervalMsSchema.describe(
    'Recommended refresh interval for draft state and pick-clock surfaces.',
  ),
  contestStatus: PollIntervalMsSchema.describe(
    'Recommended refresh interval for contest status and lifecycle surfaces.',
  ),
  notifications: PollIntervalMsSchema.describe(
    'Recommended refresh interval for unread notifications and similar badge counts.',
  ),
  default: PollIntervalMsSchema.describe(
    'Fallback refresh interval for pollable surfaces without a more specific recommendation.',
  ),
}).describe('Poll-interval configuration payload exposed to clients and root-admin tools.');
export type PollIntervalConfig = z.infer<typeof PollIntervalConfigSchema>;

export const PollIntervalConfigPatchSchema = PollIntervalConfigSchema.partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one poll interval must be provided.',
  })
  .describe('Partial poll-interval update payload used by root-admin configuration tools.');
export type PollIntervalConfigPatch = z.infer<typeof PollIntervalConfigPatchSchema>;
