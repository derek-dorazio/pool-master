/**
 * Config DTOs — request/response schemas for the runtime configuration endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { BudgetPricingProfileSchema, Sport } from '@poolmaster/shared/domain';

const SportSchema = z.enum([
  Sport.GOLF,
  Sport.NFL,
  Sport.NBA,
  Sport.F1,
  Sport.NASCAR,
  Sport.NCAA_BASKETBALL,
  Sport.NCAA_HOCKEY,
  Sport.NCAA_FOOTBALL,
  Sport.TENNIS,
  Sport.HORSE_RACING,
  Sport.SOCCER,
  Sport.NHL,
  Sport.MLB,
  Sport.UFC,
]);

export const IngestionFeedSchedulePolicySchema = z.object({
  enabled: z.boolean().describe('Whether the feed should be scheduled automatically.'),
  intervalMinutes: z.number().int().min(1).optional().describe(
    'How often the feed should run, in minutes, for interval-driven orchestration.',
  ),
  intervalSeconds: z.number().int().min(1).optional().describe(
    'How often the feed should run, in seconds, for high-frequency orchestration such as live scoring.',
  ),
  lookaheadDays: z.number().int().min(0).optional().describe(
    'How many days ahead the scheduler should scan for candidate events when the feed operates on a discovery window (event participant hydration).',
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
  scheduledSports: z.array(SportSchema).min(1).default([Sport.GOLF]).describe(
    'Sports that scheduled ingestion is allowed to run automatically.',
  ),
  healthCheck: IngestionFeedSchedulePolicySchema.describe(
    'Scheduling policy for provider health checks.',
  ),
  eventParticipants: IngestionFeedSchedulePolicySchema.describe(
    'Scheduling policy for event participant and event-scoped odds hydration before the field locks. Candidate events must be field-available and not field-locked.',
  ),
  eventLiveScores: IngestionFeedSchedulePolicySchema.describe(
    'Scheduling policy for live score polling.',
  ),
}).describe('Base ingestion scheduling configuration without per-sport overrides.');
export type IngestionScheduleConfigBody = z.infer<typeof IngestionScheduleConfigBodySchema>;

export const IngestionScheduleConfigOverrideSchema = z.object({
  scheduledSports: z.array(SportSchema).min(1).optional(),
  healthCheck: IngestionFeedSchedulePolicyPatchSchema.optional(),
  eventParticipants: IngestionFeedSchedulePolicyPatchSchema.optional(),
  eventLiveScores: IngestionFeedSchedulePolicyPatchSchema.optional(),
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

// --- Published contract (#192) -------------------------------------------------
// Served by the platform module (platform/routes.ts). IngestionFeedSchedulePolicy is not registered directly: it appears only
// nested inside IngestionScheduleConfig, and no route serves it on its own (check 2).
/** The system emails core-api can send, one per template. */
export const EmailTemplateKeySchema = z.enum([
  'LEAGUE_MEMBER_INVITE',
  'LEAGUE_JOIN_SUCCESS',
  'CONTEST_ENTRY_COMPLETED',
  'CONTEST_STARTED_SUMMARY',
]).describe('A system email template.');
export type EmailTemplateKey = z.infer<typeof EmailTemplateKeySchema>;

const templateSwitch = z.boolean().describe('Whether this email is sent.');

/**
 * EMAIL_CONFIG (#450): whether system email is sent. Transport and sender address stay in env.
 * A skipped email still counts as sent, so an invite by email still succeeds.
 */
export const EmailConfigSchema = z.object({
  enabled: z.boolean().describe('Whether any system email is sent. Off: every email is skipped and logged.'),
  replyTo: z.string().email().nullable().describe(
    'Reply-To address for system email, or null to let replies go to the sender.',
  ),
  templates: z.object({
    LEAGUE_MEMBER_INVITE: templateSwitch,
    LEAGUE_JOIN_SUCCESS: templateSwitch,
    CONTEST_ENTRY_COMPLETED: templateSwitch,
    CONTEST_STARTED_SUMMARY: templateSwitch,
  } satisfies Record<EmailTemplateKey, z.ZodBoolean>).describe(
    'Per-template switches. A template that is off is skipped even while email is on.',
  ),
}).describe('Whether and how system email is sent.');
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

/**
 * BUDGET_PRICING_CONFIG (#93): the named sets of values an admin prices an event's field with
 * for budget contests. The first profile is the one the price dialog starts on.
 */
export const BudgetPricingConfigSchema = z.object({
  profiles: z.array(BudgetPricingProfileSchema).min(1).max(10).describe(
    'The pricing profiles, the default first. Names are unique.',
  ),
}).describe('The named sets of values an event\'s field is priced with for budget contests.');
export type BudgetPricingConfig = z.infer<typeof BudgetPricingConfigSchema>;

registerSchema('EmailTemplateKey', EmailTemplateKeySchema);
registerSchema('EmailConfig', EmailConfigSchema);
registerSchema('BudgetPricingProfile', BudgetPricingProfileSchema);
registerSchema('BudgetPricingConfig', BudgetPricingConfigSchema);
registerSchema('IngestionScheduleConfigOverride', IngestionScheduleConfigOverrideSchema);
registerSchema('IngestionScheduleConfig', IngestionScheduleConfigSchema);
