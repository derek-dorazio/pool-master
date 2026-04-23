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

export const IngestionFeedSchedulePolicySchema = z.object({
  enabled: z.boolean().describe('Whether the feed should be scheduled automatically.'),
  intervalMinutes: z.number().int().min(1).optional().describe(
    'How often the feed should run, in minutes, for interval-driven orchestration.',
  ),
  intervalSeconds: z.number().int().min(1).optional().describe(
    'How often the feed should run, in seconds, for high-frequency orchestration such as live scoring.',
  ),
  lookaheadDays: z.number().int().min(0).optional().describe(
    'How many days ahead the scheduler should scan for candidate events when the feed operates on a discovery window.',
  ),
  leadDaysBeforeStart: z.number().int().min(0).optional().describe(
    'How many days before event start a feed becomes eligible to run for that event lifecycle window.',
  ),
}).describe('Feed-specific ingestion scheduling policy.');
export type IngestionFeedSchedulePolicy = z.infer<typeof IngestionFeedSchedulePolicySchema>;

export const IngestionFeedSchedulePolicyPatchSchema = IngestionFeedSchedulePolicySchema.partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one feed scheduling property must be provided.',
  })
  .describe('Partial feed-scheduling override payload.');
export type IngestionFeedSchedulePolicyPatch = z.infer<typeof IngestionFeedSchedulePolicyPatchSchema>;

export const IngestionScheduleConfigBodySchema = z.object({
  healthCheck: IngestionFeedSchedulePolicySchema.describe(
    'Scheduling policy for provider health checks.',
  ),
  eventSchedule: IngestionFeedSchedulePolicySchema.describe(
    'Scheduling policy for event schedule discovery.',
  ),
  eventParticipants: IngestionFeedSchedulePolicySchema.describe(
    'Scheduling policy for event participant hydration before the event starts.',
  ),
  participantRankings: IngestionFeedSchedulePolicySchema.describe(
    'Scheduling policy for ranking refreshes.',
  ),
  eventLiveScores: IngestionFeedSchedulePolicySchema.describe(
    'Scheduling policy for live score polling.',
  ),
  eventResults: IngestionFeedSchedulePolicySchema.describe(
    'Scheduling policy for completed-event result refreshes.',
  ),
}).describe('Base ingestion scheduling configuration without per-sport overrides.');
export type IngestionScheduleConfigBody = z.infer<typeof IngestionScheduleConfigBodySchema>;

export const IngestionScheduleConfigOverrideSchema = z.object({
  healthCheck: IngestionFeedSchedulePolicyPatchSchema.optional(),
  eventSchedule: IngestionFeedSchedulePolicyPatchSchema.optional(),
  eventParticipants: IngestionFeedSchedulePolicyPatchSchema.optional(),
  participantRankings: IngestionFeedSchedulePolicyPatchSchema.optional(),
  eventLiveScores: IngestionFeedSchedulePolicyPatchSchema.optional(),
  eventResults: IngestionFeedSchedulePolicyPatchSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one ingestion feed override must be provided.',
}).describe('Partial ingestion scheduling override used for global updates and per-sport overrides.');
export type IngestionScheduleConfigOverride = z.infer<typeof IngestionScheduleConfigOverrideSchema>;

export const IngestionScheduleConfigSchema = IngestionScheduleConfigBodySchema.extend({
  perSportOverrides: z.record(IngestionScheduleConfigOverrideSchema).describe(
    'Per-sport scheduling overrides applied on top of the global feed policies.',
  ),
}).describe('Feed-aware ingestion scheduling configuration exposed to root-admin tooling.');
export type IngestionScheduleConfig = z.infer<typeof IngestionScheduleConfigSchema>;
