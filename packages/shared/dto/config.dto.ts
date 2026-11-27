/**
 * Config DTOs — request/response schemas for the runtime configuration endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  EmailTemplateKey,
  LeaguePlan,
  ProviderSyncKind,
  SyncSeasonState,
  type PlanCap,
  type PlanFeature,
  type SwitchableEmailTemplateKey,
} from '@poolmaster/shared/domain';


/** How often a sync runs in one Season state. */
const IngestionScheduleIntervalSchema = z.object({
  intervalMinutes: z.number().int().min(1).optional().describe(
    'How often the sync runs, in minutes.',
  ),
  intervalSeconds: z.number().int().min(1).optional().describe(
    'How often the sync runs, in seconds, for a high-frequency sync such as live scores. Wins over intervalMinutes.',
  ),
}).refine((interval) => interval.intervalMinutes !== undefined || interval.intervalSeconds !== undefined, {
  message: 'Give the interval in minutes or in seconds.',
}).describe('How often a sync runs in one Season state: in minutes or in seconds, at least one.');

/**
 * A sync kind's interval for each Season state (#2009): in season, while one of a league's
 * Seasons' spans holds now, and off season otherwise (`syncSeasonStateOf`).
 */
const IngestionSeasonIntervalsSchema = z.object({
  [SyncSeasonState.IN_SEASON]: IngestionScheduleIntervalSchema.describe('How often the sync runs for a league in season.'),
  [SyncSeasonState.OFFSEASON]: IngestionScheduleIntervalSchema.describe('How often the sync runs for a league off season.'),
}).describe('A sync kind\'s interval for each Season state.');

const IngestionSeasonIntervalsPatchSchema = z.object({
  [SyncSeasonState.IN_SEASON]: IngestionScheduleIntervalSchema.optional(),
  [SyncSeasonState.OFFSEASON]: IngestionScheduleIntervalSchema.optional(),
}).describe('The Season states whose interval changes.');

/** A sync kind's policy with a switch: an admin can turn it off. */
export const IngestionFeedSchedulePolicySchema = z.object({
  enabled: z.boolean().describe('Whether the sync is scheduled automatically.'),
  intervals: IngestionSeasonIntervalsSchema,
}).describe('A sync kind\'s scheduling policy, with a switch.');
export type IngestionFeedSchedulePolicy = z.infer<typeof IngestionFeedSchedulePolicySchema>;

/**
 * The FIELD sync's policy (#2086): it has no switch. It always runs, for synced sport leagues
 * only, since every active league is provider-synced.
 */
export const IngestionAlwaysOnSchedulePolicySchema = z.object({
  intervals: IngestionSeasonIntervalsSchema,
}).describe('A sync kind\'s scheduling policy that has no switch: it always runs.');
export type IngestionAlwaysOnSchedulePolicy = z.infer<typeof IngestionAlwaysOnSchedulePolicySchema>;

const atLeastOneProperty = (value: object) => Object.keys(value).length > 0;
const AT_LEAST_ONE_PROPERTY = { message: 'At least one scheduling property must be provided.' };

export const IngestionFeedSchedulePolicyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  intervals: IngestionSeasonIntervalsPatchSchema.optional(),
}).refine(atLeastOneProperty, AT_LEAST_ONE_PROPERTY)
  .describe('Partial scheduling update for a sync kind with a switch.');
export type IngestionFeedSchedulePolicyPatch = z.infer<typeof IngestionFeedSchedulePolicyPatchSchema>;

const IngestionAlwaysOnSchedulePolicyPatchSchema = z.object({
  intervals: IngestionSeasonIntervalsPatchSchema,
}).describe('Partial scheduling update for a sync kind with no switch.');

/**
 * One schedule for every sport league (#1871), keyed by `ProviderSyncKind` (#1999): there are no
 * per-sport overrides, and which sports sync is which provider leagues are enabled (#1997). Each
 * kind has an interval per Season state (#2009).
 */
export const IngestionScheduleConfigSchema = z.object({
  [ProviderSyncKind.EVENTS]: IngestionFeedSchedulePolicySchema.describe(
    'The EVENTS sync: how often each synced sport league\'s events sync is queued.',
  ),
  [ProviderSyncKind.FIELD]: IngestionAlwaysOnSchedulePolicySchema.describe(
    'The FIELD sync: the field and event-scoped odds of each event in a synced sport league\'s next slot. It has no switch.',
  ),
  [ProviderSyncKind.SCORES]: IngestionFeedSchedulePolicySchema.describe(
    'The SCORES sync: live score polling for each event with a Game due or in play.',
  ),
  [ProviderSyncKind.ROSTER]: IngestionAlwaysOnSchedulePolicySchema.describe(
    'The ROSTER sync: each synced sport league\'s roster for its current Season, in a league whose provider names its positions. It has no switch.',
  ),
}).describe('Feed-aware ingestion scheduling configuration, one schedule for every sport league, keyed by sync kind.');
export type IngestionScheduleConfig = z.infer<typeof IngestionScheduleConfigSchema>;

export const IngestionScheduleConfigPatchSchema = z.object({
  [ProviderSyncKind.EVENTS]: IngestionFeedSchedulePolicyPatchSchema.optional(),
  [ProviderSyncKind.FIELD]: IngestionAlwaysOnSchedulePolicyPatchSchema.optional(),
  [ProviderSyncKind.SCORES]: IngestionFeedSchedulePolicyPatchSchema.optional(),
  [ProviderSyncKind.ROSTER]: IngestionAlwaysOnSchedulePolicyPatchSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one ingestion schedule change must be provided.',
}).describe('Partial ingestion schedule update: only the sync kinds, states and properties it names change.');
export type IngestionScheduleConfigPatch = z.infer<typeof IngestionScheduleConfigPatchSchema>;

export const IngestionSyncScheduleSchema = z.object({
  enabled: z.boolean().optional().describe('The sync\'s switch; absent for a sync with none.'),
  intervals: IngestionSeasonIntervalsSchema,
  runs: z.boolean().describe('Whether the sync runs on its interval now.'),
  switchable: z.boolean().describe('Whether the sync has a switch an admin can turn off; a sync with none always runs.'),
}).describe('One sync kind\'s schedule as the read answers it: its intervals per Season state, whether it runs, and whether it has a switch.');
export type IngestionSyncSchedule = z.infer<typeof IngestionSyncScheduleSchema>;

/** The schedule read (#2086): each sync kind's policy, whether it runs and whether it has a switch. */
export const IngestionScheduleSchema = z.object({
  [ProviderSyncKind.EVENTS]: IngestionSyncScheduleSchema,
  [ProviderSyncKind.FIELD]: IngestionSyncScheduleSchema,
  [ProviderSyncKind.SCORES]: IngestionSyncScheduleSchema,
  [ProviderSyncKind.ROSTER]: IngestionSyncScheduleSchema,
}).describe('The ingestion schedule as the API answers it: per sync kind, its policy, whether it runs and whether it has a switch.');
export type IngestionSchedule = z.infer<typeof IngestionScheduleSchema>;

// --- Published contract (#192) -------------------------------------------------
// Served by the platform module (platform/routes.ts). IngestionFeedSchedulePolicy is not registered directly: it appears only
// nested inside IngestionScheduleConfig, and no route serves it on its own (check 2).
/** The system emails core-api can send, one per template. */
export const EmailTemplateKeySchema = z.enum(EmailTemplateKey).describe('A system email template.');

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
    + 'every league, so it is waiting in the morning. The next day\'s "New member joined" email for '
    + 'a busy day goes at the same hour every day (#903).',
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
    CONTEST_REOPENED: templateSwitch,
    EVENT_COMING_UP: templateSwitch,
    EVENT_READY_FOR_CONTESTS: templateSwitch,
    EVENT_WEEKLY_DIGEST: templateSwitch,
    LEAGUE_MEMBER_JOINED: templateSwitch,
    CONTEST_EXPANDED: templateSwitch,
    LEAGUE_PLAN_PREVIEW_ENDING: templateSwitch,
    CONTEST_NOT_OPEN: templateSwitch,
    EVENT_STILL_DRAFT: templateSwitch,
    YEAR_IN_REVIEW: templateSwitch,
  } satisfies Record<SwitchableEmailTemplateKey, z.ZodBoolean>).describe(
    'Per-template switches. A template that is off is skipped even while email is on.',
  ),
}).describe('Whether and how system email is sent.');
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

/** A plan's limit on one cap: a whole number, or null for unlimited. */
const PlanCapLimitSchema = z.number().int().min(1).max(100_000).nullable().describe(
  'The most this plan allows, or null for unlimited.',
);

const PlanCapRowSchema = z.object({
  FREE: PlanCapLimitSchema,
  PRO: PlanCapLimitSchema,
  PREMIUM: PlanCapLimitSchema,
  PLATINUM: PlanCapLimitSchema,
} satisfies Record<LeaguePlan, typeof PlanCapLimitSchema>).describe(
  'One cap\'s limit on each plan. A limit never falls as the plan rises.',
);
export type PlanCapRow = z.infer<typeof PlanCapRowSchema>;

const featureStartsAt = z.enum(LeaguePlan).describe('The first plan that has the feature; every plan above it has it too.');

/**
 * PLAN_CONFIG (#944): what each league plan allows. Two caps per plan, Platinum's included
 * (plans/payments.md §3), and the first plan each feature starts at; Platinum has every feature
 * because every feature starts at Platinum or below. Root admins edit it on the Plans page. A row
 * saved before Platinum had caps loads with Platinum's defaults filled in.
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

/** One band of a plan's expansion price list (#980): a contest expanded to it takes up to that many entries. */
export const ExpansionPriceSchema = z.object({
  entriesPerContest: z.number().int().min(1).max(100_000).describe('The band: the most entries an expanded contest takes.'),
  priceCents: z.number().int().min(0).max(1_000_000).describe('What expanding a contest to this band costs, in US cents.'),
}).describe('One expansion band and its price.');
export type ExpansionPrice = z.infer<typeof ExpansionPriceSchema>;

const ExpansionPriceListSchema = z.array(ExpansionPriceSchema).max(10).describe(
  'The plan\'s bands, smallest first; each band and each price above the one before. '
  + 'A band at or below the plan\'s included entries (PLAN_CONFIG\'s ENTRIES_PER_CONTEST cap) is never offered.',
);

const subscriptionCents = z.number().int().min(0).max(1_000_000);

/** One plan's subscription price (#1885): set by a root admin on the Pricing page, charged by nothing yet. */
export const PlanPriceSchema = z.object({
  yearlyCents: subscriptionCents.describe('A year of the plan, in US cents.'),
  monthlyCents: subscriptionCents.describe('A month of the plan, in US cents.'),
}).describe('What a plan costs a year and a month, in US cents. Nothing charges it while payments are off.');
export type PlanPrice = z.infer<typeof PlanPriceSchema>;

/**
 * BILLING_CONFIG (#980): whether payments are on, each plan's subscription price (#1885) and each
 * plan's expansion price list (plans/payments.md §3, §9). While payments are off, expanding a
 * contest is free and recorded as a $0 line in the league's payment history. A row saved before
 * plan prices existed loads with every plan's price at its default.
 */
export const BillingConfigSchema = z.object({
  paymentsEnabled: z.boolean().describe(
    'Whether expansions are charged. Off until checkout is built (#981): while off, commissioners expand contests free.',
  ),
  planPrices: z.object({
    FREE: PlanPriceSchema,
    PRO: PlanPriceSchema,
    PREMIUM: PlanPriceSchema,
    PLATINUM: PlanPriceSchema,
  } satisfies Record<LeaguePlan, typeof PlanPriceSchema>).describe(
    'Each plan\'s yearly and monthly subscription price, set on the Pricing page.',
  ),
  expansionPrices: z.object({
    FREE: ExpansionPriceListSchema,
    PRO: ExpansionPriceListSchema,
    PREMIUM: ExpansionPriceListSchema,
    PLATINUM: ExpansionPriceListSchema,
  } satisfies Record<LeaguePlan, typeof ExpansionPriceListSchema>).describe(
    'Each plan\'s expansion price list. A contest is offered the bands above its cap; a step up costs the difference.',
  ),
}).describe('Payments: whether they are on, what each plan costs, and what expanding a contest costs on each plan.');
export type BillingConfig = z.infer<typeof BillingConfigSchema>;

registerSchema('EmailTemplateKey', EmailTemplateKeySchema);
registerSchema('EmailConfig', EmailConfigSchema);
registerSchema('PlanCapRow', PlanCapRowSchema);
registerSchema('PlanConfig', PlanConfigSchema);
registerSchema('ExpansionPrice', ExpansionPriceSchema);
registerSchema('PlanPrice', PlanPriceSchema);
registerSchema('BillingConfig', BillingConfigSchema);
registerSchema('IngestionScheduleConfigPatch', IngestionScheduleConfigPatchSchema);
registerSchema('IngestionScheduleConfig', IngestionScheduleConfigSchema);
registerSchema('IngestionSyncSchedule', IngestionSyncScheduleSchema);
registerSchema('IngestionSchedule', IngestionScheduleSchema);
