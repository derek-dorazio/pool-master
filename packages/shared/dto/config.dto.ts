/**
 * Config DTOs — request/response schemas for the runtime configuration endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  BudgetPricingProfileSchema,
  EmailTemplateKey,
  Sport,
  SUPPORTED_SPORTS,
  type SwitchableEmailTemplateKey,
} from '@poolmaster/shared/domain';

const SportSchema = z.nativeEnum(Sport);

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
  scheduledSports: z.array(SportSchema).min(1).default([...SUPPORTED_SPORTS]).describe(
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
export const EmailTemplateKeySchema = z.nativeEnum(EmailTemplateKey).describe('A system email template.');

const templateSwitch = z.boolean().describe('Whether this email is sent.');

/** A whole address, or `@domain` for every address at that domain. Compared case-insensitively. */
export const EmailRecipientPatternSchema = z.string().trim().toLowerCase().max(254).regex(
  /^([^\s@]+)?@[a-z0-9-]+(\.[a-z0-9-]+)+$/,
  'Enter an email address or @domain.',
).describe('An email address, or @domain for every address at that domain.');

/**
 * EMAIL_CONFIG (#450): whether system email is sent, and to whom. Transport and sender address
 * stay in env. System email has no Reply-To (#844).
 * A skipped email still counts as sent, so an invite by email still succeeds.
 */
export const EmailConfigSchema = z.object({
  enabled: z.boolean().describe('Whether any system email is sent. Off: every email is skipped and logged.'),
  allowedRecipients: z.array(EmailRecipientPatternSchema).max(100).describe(
    'When not empty, the only addresses email is sent to (addresses or @domain); every other '
    + 'recipient is skipped and logged. Empty: no limit.',
  ),
  sendRatePerSecond: z.number().int().min(1).max(100).describe(
    'The most emails each API server task sends a second. SES accounts start at 14 a second in all.',
  ),
  entryReminderHours: z.array(z.number().int().min(1).max(168)).min(1).max(5).describe(
    'How many hours before a contest\'s picks close each entry reminder goes, to members with '
    + 'nothing submitted (#845). Everyone gets each reminder at the same moment.',
  ),
  standingsBufferMinutes: z.number().int().min(0).max(240).describe(
    'How many minutes after a round, week or event finishes its live standings email goes (#877), '
    + 'so a late score correction lands first.',
  ),
  templates: z.object({
    LEAGUE_MEMBER_INVITE: templateSwitch,
    LEAGUE_JOIN_SUCCESS: templateSwitch,
    SQUAD_OWNER_INVITE: templateSwitch,
    SQUAD_OWNER_ADDED: templateSwitch,
    CONTEST_ENTRY_COMPLETED: templateSwitch,
    CONTEST_STARTED_SUMMARY: templateSwitch,
    CONTEST_ENTRY_REMINDER: templateSwitch,
    CONTEST_OPENED: templateSwitch,
    CONTEST_STANDINGS: templateSwitch,
    CONTEST_RESULTS: templateSwitch,
    CONTEST_EVENT_CHANGED: templateSwitch,
    EVENT_COMING_UP: templateSwitch,
    EVENT_READY_FOR_CONTESTS: templateSwitch,
    CONTEST_NOT_OPEN: templateSwitch,
    EVENT_STILL_DRAFT: templateSwitch,
    YEAR_IN_REVIEW: templateSwitch,
  } satisfies Record<SwitchableEmailTemplateKey, z.ZodBoolean>).describe(
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
