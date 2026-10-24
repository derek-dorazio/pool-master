/**
 * Config DTOs — request/response schemas for the runtime configuration endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  BudgetPricingProfileSchema,
  EmailTemplateKey,
  LeaguePlan,
  type CappedLeaguePlan,
  type PlanCap,
  type PlanFeature,
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
  weeklyDigestHour: z.number().int().min(0).max(23).describe(
    'The hour on Monday, US Eastern time, every weekly event digest goes (#851): one moment for '
    + 'every league, so it is waiting in the morning.',
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
    EVENT_WEEKLY_DIGEST: templateSwitch,
    LEAGUE_MEMBER_JOINED: templateSwitch,
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

/** A plan's limit on one cap: a whole number, or null for unlimited. */
const PlanCapLimitSchema = z.number().int().min(1).max(100_000).nullable().describe(
  'The most this plan allows, or null for unlimited.',
);

const PlanCapRowSchema = z.object({
  FREE: PlanCapLimitSchema,
  PRO: PlanCapLimitSchema,
  PREMIUM: PlanCapLimitSchema,
} satisfies Record<CappedLeaguePlan, typeof PlanCapLimitSchema>).describe(
  'One cap\'s limit on each plan but Platinum, which is always unlimited. A limit never falls as the plan rises.',
);
export type PlanCapRow = z.infer<typeof PlanCapRowSchema>;

const featureStartsAt = z.nativeEnum(LeaguePlan).describe('The first plan that has the feature; every plan above it has it too.');

/**
 * PLAN_CONFIG (#944): what each league plan allows. Two caps per plan, and the first plan each
 * feature starts at. Platinum has no limits, so it has no cap values to set, and it has every
 * feature because every feature starts at Platinum or below. Root admins edit it on the Plans page.
 */
export const PlanConfigSchema = z.object({
  caps: z.object({
    ENTRIES_PER_CONTEST: PlanCapRowSchema.describe(
      'Entries per contest, drafts included. Checked when an entry is added.',
    ),
    SPORTS_LEAGUES_PER_YEAR: PlanCapRowSchema.describe(
      'Different sports leagues among the league\'s contests this calendar year, drafts included, '
      + 'deleted and cancelled contests not. Checked when a contest is created.',
    ),
  } satisfies Record<PlanCap, typeof PlanCapRowSchema>).describe('Each cap\'s limit on each plan.'),
  features: z.object({
    EMAIL_CONTEST_OPENED: featureStartsAt,
    EMAIL_CONTEST_ENTRY_COMPLETED: featureStartsAt,
    EMAIL_CONTEST_RESULTS: featureStartsAt,
    EMAIL_CONTEST_EVENT_CHANGED: featureStartsAt,
    EMAIL_CONTEST_STARTED_SUMMARY: featureStartsAt,
    EMAIL_CONTEST_ENTRY_REMINDER: featureStartsAt,
    EMAIL_CONTEST_STANDINGS: featureStartsAt,
    EMAIL_EVENT_COMING_UP: featureStartsAt,
    EMAIL_EVENT_READY_FOR_CONTESTS: featureStartsAt,
    EMAIL_CONTEST_NOT_OPEN: featureStartsAt,
    EMAIL_YEAR_IN_REVIEW: featureStartsAt,
    EMAIL_LEAGUE_MEMBER_JOINED: featureStartsAt,
    CUP_STANDINGS: featureStartsAt,
    CUP_CROWNING: featureStartsAt,
    CHAMPIONSHIP: featureStartsAt,
    TROPHY_SHELF: featureStartsAt,
    CUP_SETTINGS: featureStartsAt,
    PAST_YEARS: featureStartsAt,
    ALL_TIME_SUMMARY: featureStartsAt,
    RECORD_BOOK: featureStartsAt,
  } satisfies Record<PlanFeature, typeof featureStartsAt>).describe('The plan each feature starts at.'),
}).describe('What each league plan allows: its caps and the plan each feature starts at.');
export type PlanConfig = z.infer<typeof PlanConfigSchema>;

registerSchema('EmailTemplateKey', EmailTemplateKeySchema);
registerSchema('EmailConfig', EmailConfigSchema);
registerSchema('BudgetPricingProfile', BudgetPricingProfileSchema);
registerSchema('BudgetPricingConfig', BudgetPricingConfigSchema);
registerSchema('PlanCapRow', PlanCapRowSchema);
registerSchema('PlanConfig', PlanConfigSchema);
registerSchema('IngestionScheduleConfigOverride', IngestionScheduleConfigOverrideSchema);
registerSchema('IngestionScheduleConfig', IngestionScheduleConfigSchema);
