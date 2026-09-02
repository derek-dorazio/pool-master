import { z } from 'zod';
import {
  ContestStatus,
  ContestFormat,
  GolfCategoryKey,
  GolfContestConfigMode,
  GolfCutRuleType,
  Sport,
} from '@poolmaster/shared/domain';

const sportValues = Object.values(Sport) as [Sport, ...Sport[]];
const contestFormatValues = Object.values(ContestFormat) as [
  ContestFormat,
  ...ContestFormat[],
];

const nullablePositiveIntSchema = z
  .number()
  .int()
  .min(1)
  .nullable()
  .optional()
  .describe('Maximum entries a Team may create. Null means unlimited.');

export const GolfFixedCutRuleSchema = z.object({
  type: z.enum([GolfCutRuleType.FIXED_SCORE]),
  fixedScore: z.number().int().min(0).describe('Fallback score assigned when a golfer misses the cut.'),
}).describe('Golf cut rule for first-pass contests.');
export type GolfFixedCutRuleDto = z.infer<typeof GolfFixedCutRuleSchema>;

export const GolfTiebreakerSchema = z.object({
  type: z.literal('PREDICT_WINNING_SCORE'),
}).describe('Golf tiebreaker configuration. Teams predict the winning to-par score.');
export type GolfTiebreakerDto = z.infer<typeof GolfTiebreakerSchema>;

export const GolfContestTierSchema = z.object({
  tierKey: z.string().min(1).describe('Stable tier key such as A, B, or C.'),
  label: z.string().min(1).describe('Commissioner-facing tier label.'),
  pickCount: z.number().int().min(1).describe('How many golfers must be picked from the tier.'),
  startPosition: z.number().int().min(1).describe('Starting resolved rank/odds position for the tier.'),
  endPosition: z.number().int().min(1).nullable().describe('Ending resolved rank/odds position for the tier. Null means remainder of field.'),
}).describe('Tier definition for a golf tiered contest.');
export type GolfContestTierDto = z.infer<typeof GolfContestTierSchema>;

export const GolfCategoryDefinitionSchema = z.object({
  categoryKey: z.enum([
    GolfCategoryKey.SENIOR,
    GolfCategoryKey.ROOKIE,
    GolfCategoryKey.PREVIOUS_WINNER,
    GolfCategoryKey.US_PLAYER,
    GolfCategoryKey.INTERNATIONAL_PLAYER,
  ]),
  label: z.string().min(1).describe('Commissioner-facing category label.'),
  pickCount: z.number().int().min(1).describe('How many golfers must be picked for the category.'),
}).describe('Category slot definition for a golf category-picks contest.');
export type GolfCategoryDefinitionDto = z.infer<typeof GolfCategoryDefinitionSchema>;

/**
 * Shrunk per plans/124 §4.6/§4.6a: tiers/price are event-owned data resolved
 * via golf-tier-service.getEffectiveTiersForContest, never a per-contest
 * override, so tierSource/tierGeneration/tiers drop; cutRule/playoffHandling/
 * displayScoring/tiebreaker each locked to exactly one possible value with
 * zero real reads downstream, dropped as dead configuration.
 */
export const GolfTieredContestConfigurationSchema = z.object({
  mode: z.literal(GolfContestConfigMode.GOLF_TIERED),
  locksAt: z.string().datetime().nullable().optional().describe('Contest entry lock timestamp.'),
  maxEntriesPerSquad: nullablePositiveIntSchema,
  rosterSize: z.number().int().min(1).describe('How many golfers each Team entry must pick.'),
  countedScores: z.number().int().min(1).describe('How many golfer scores count toward the Team total.'),
}).describe('Golf tiered contest configuration for pick-X, count-best-Y roster contests.');
export type GolfTieredContestConfigurationRequest = z.infer<
  typeof GolfTieredContestConfigurationSchema
>;

// GOLF_CATEGORY_PICKS was a fully-typed stub with no backend implementation and
// was removed (plans/124 §4.11). Only the tiered mode remains, so the request
// payload is a single-member discriminated union keyed on `mode` — a shape that
// stays additively extensible when plans/127 rebuilds category picks for real.
export const ContestConfigurationRequestSchema = z.discriminatedUnion('mode', [
  GolfTieredContestConfigurationSchema,
]).describe('Approved commissioner-managed contest configuration payload for golf-first contest creation.');
export type ContestConfigurationRequest = z.infer<
  typeof ContestConfigurationRequestSchema
>;

const CreateContestManagementBaseSchema = z.object({
  name: z.string().min(1).max(100).describe('Contest name shown to commissioners and members.'),
  sportEventId: z.string().uuid().describe('Sport-event identifier that anchors the contest.'),
  contestFormat: z.literal(ContestFormat.ROSTER).describe(
    'First-pass managed contest creation supports roster contests only. The domain validity matrix catalogs future format compatibility.',
  ),
});

export const LegacyCreateContestManagementRequestSchema =
  CreateContestManagementBaseSchema.extend({
    configuration: ContestConfigurationRequestSchema,
  }).describe('Legacy commissioner request payload that supplies the full contest configuration directly.');

export const TemplateCreateContestManagementRequestSchema =
  CreateContestManagementBaseSchema.extend({
    templateId: z.string().uuid().describe('Seeded contest template selected for the create flow.'),
    configurationOverrides: ContestConfigurationRequestSchema.optional().describe(
      'Optional full configuration payload used after selecting advanced mode. First pass expects a complete configuration object when overrides are supplied.',
    ),
  }).describe('Template-first commissioner request payload for creating a managed contest.');

export const CreateContestManagementRequestSchema = z.union([
  LegacyCreateContestManagementRequestSchema,
  TemplateCreateContestManagementRequestSchema,
]).describe('Commissioner request payload for creating a golf-first managed contest.');
export type CreateContestManagementRequest = z.infer<
  typeof CreateContestManagementRequestSchema
>;

export const UpdateContestConfigurationRequestSchema =
  ContestConfigurationRequestSchema;
export type UpdateContestConfigurationRequest = z.infer<
  typeof UpdateContestConfigurationRequestSchema
>;

export const GolfTieredContestConfigurationDtoSchema =
  GolfTieredContestConfigurationSchema.extend({
    id: z.string().describe('Contest-configuration identifier.'),
    contestId: z.string().describe('Contest that owns the configuration.'),
  });

export const ContestConfigurationDtoSchema = z.discriminatedUnion('mode', [
  GolfTieredContestConfigurationDtoSchema,
]).describe('Persisted commissioner-managed golf contest configuration.');
export type ContestConfigurationDto = z.infer<typeof ContestConfigurationDtoSchema>;

export const ContestConfigTemplateDtoSchema = z.object({
  id: z.string().uuid().describe('Seeded contest template identifier.'),
  sport: z.enum(sportValues).describe('Sport this template applies to.'),
  eventType: z.string().nullable().optional().describe('Optional event-type scope for the template.'),
  contestFormat: z.enum(contestFormatValues).describe('Contest type that may use the template.'),
  configMode: z.enum([
    GolfContestConfigMode.GOLF_TIERED,
  ]).describe('Configuration mode seeded by the template.'),
  templateKey: z.string().describe('Stable machine key for the template.'),
  name: z.string().describe('Commissioner-facing template label.'),
  description: z.string().describe('Commissioner-facing template description.'),
  sortOrder: z.number().int().describe('Display order for template selection.'),
  isDefault: z.boolean().describe('Whether the template should be preselected in the create flow.'),
  active: z.boolean().describe('Whether the template is currently selectable.'),
  schemaVersion: z.number().int().describe('Version of the configuration schema metadata expected by the template.'),
  configuration: ContestConfigurationRequestSchema.describe('Seeded configuration payload copied into a contest instance when the template is chosen.'),
}).describe('Seeded commissioner-facing contest configuration template.');
export type ContestConfigTemplateDto = z.infer<typeof ContestConfigTemplateDtoSchema>;

export const ListContestConfigTemplatesQuerySchema = z.object({
  sport: z.enum(sportValues).describe('Sport to filter templates by.'),
  contestFormat: z.enum(contestFormatValues).describe('Contest type to filter templates by.'),
  eventType: z.string().optional().describe('Optional event type used to narrow template selection.'),
}).describe('Query parameters for listing commissioner contest templates.');
export type ListContestConfigTemplatesQuery = z.infer<
  typeof ListContestConfigTemplatesQuerySchema
>;

export const ContestConfigTemplateListResponseSchema = z.object({
  templates: z.array(ContestConfigTemplateDtoSchema),
}).describe('Available seeded contest templates for commissioner create flow.');
export type ContestConfigTemplateListResponse = z.infer<
  typeof ContestConfigTemplateListResponseSchema
>;

export const AdminListContestConfigTemplatesQuerySchema = z.object({
  sport: z.enum(sportValues).optional().describe('Optional sport filter for root-admin contest template management.'),
  contestFormat: z.enum(contestFormatValues).optional().describe('Optional contest-type filter for root-admin contest template management.'),
  active: z.boolean().optional().describe('Optional active-state filter for root-admin contest template management.'),
}).describe('Query parameters for root-admin contest template management listing.');
export type AdminListContestConfigTemplatesQuery = z.infer<
  typeof AdminListContestConfigTemplatesQuerySchema
>;

export const AdminUpdateContestConfigTemplateRequestSchema = z.object({
  name: z.string().min(1).max(120).optional().describe('Updated root-admin template display name.'),
  description: z.string().min(1).max(500).optional().describe('Updated root-admin template description.'),
  sortOrder: z.number().int().min(0).max(1000).optional().describe('Updated sort order for the template within its create-flow group.'),
  isDefault: z.boolean().optional().describe('Whether this template should be the default choice for future create flows in its scope.'),
  active: z.boolean().optional().describe('Whether commissioners can select this template in future create flows.'),
  configuration: ContestConfigurationRequestSchema.optional().describe('Updated persisted configuration payload copied into future contests when this template is selected.'),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one contest template property must be provided.',
}).describe('Root-admin contest template update payload.');
export type AdminUpdateContestConfigTemplateRequest = z.infer<
  typeof AdminUpdateContestConfigTemplateRequestSchema
>;

export const AdminContestConfigTemplateResponseSchema = z.object({
  template: ContestConfigTemplateDtoSchema,
}).describe('Single root-admin contest template response.');
export type AdminContestConfigTemplateResponse = z.infer<
  typeof AdminContestConfigTemplateResponseSchema
>;

/**
 * Read-only echo of the tier structure a contest inherits from its linked
 * SportEvent (plans/124 §4.6/§5.3). Tiers are event-owned — never
 * contest-configured — so this is display-only: the commissioner UI shows
 * what the contest inherited without a mode flag to branch on. Resolved
 * through golf-tier-service.getEffectiveTiersForSportEvent, the same
 * resolution the root-admin golf tier routes read.
 */
export const GolfEffectiveTierAssignmentDtoSchema = z.object({
  sportEventParticipantId: z.string().describe('Field entry the assignment belongs to.'),
  participantId: z.string().describe('Global golfer identity.'),
  tierOrderIndex: z.number().int().nullable().describe('Within-tier ordering position; null when the golfer has no explicit order.'),
  price: z.number().nullable().describe('Per-golfer budget price when the event defines one; null otherwise.'),
}).describe("One golfer's inherited tier placement for the contest's linked event.");
export type GolfEffectiveTierAssignmentDto = z.infer<typeof GolfEffectiveTierAssignmentDtoSchema>;

export const GolfEffectiveTierDtoSchema = z.object({
  tierKey: z.string().describe('Stable per-event tier key.'),
  label: z.string().describe('Commissioner-facing tier label.'),
  tierNumber: z.number().int().describe('1-based tier ordering.'),
  defaultPickCount: z.number().int().describe('Default number of golfers picked from this tier.'),
  assignments: z.array(GolfEffectiveTierAssignmentDtoSchema).describe('Golfers assigned to this tier, ordered by tierOrderIndex ascending.'),
}).describe('One inherited event tier and its golfer assignments.');
export type GolfEffectiveTierDto = z.infer<typeof GolfEffectiveTierDtoSchema>;

export const ContestManagementDetailDtoSchema = z.object({
  id: z.string().describe('Contest identifier.'),
  leagueId: z.string().describe('League that owns the contest.'),
  sportEventId: z.string().describe('Sport event attached to the contest.'),
  name: z.string().describe('Contest display name.'),
  status: z.enum([
    ContestStatus.DRAFT,
    ContestStatus.OPEN,
    ContestStatus.DRAFTING,
    ContestStatus.LOCKED,
    ContestStatus.ACTIVE,
    ContestStatus.COMPLETED,
    ContestStatus.CANCELLED,
  ]),
  configuration: ContestConfigurationDtoSchema.describe('Current commissioner-managed contest configuration.'),
  effectiveTiers: z.array(GolfEffectiveTierDtoSchema).describe(
    "Read-only tier structure the contest inherits from its linked SportEvent (plans/124 §4.6/§5.3). Empty when the event has no tiers defined yet. Never contest-configured.",
  ),
  createdAt: z.string().datetime().describe('When the contest was created.'),
  updatedAt: z.string().datetime().describe('When the contest was last updated.'),
  templateId: z.string().uuid().nullable().optional().describe('Seeded template chosen when the contest was created, if any.'),
  templateVersion: z.number().int().nullable().optional().describe('Schema/template version captured when the contest was created, if any.'),
}).describe('Golf-first contest-management detail returned to commissioner tooling.');
export type ContestManagementDetailDto = z.infer<
  typeof ContestManagementDetailDtoSchema
>;

export const ContestManagementResponseSchema = z.object({
  contest: ContestManagementDetailDtoSchema,
}).describe('Managed-contest detail response.');
export type ContestManagementResponse = z.infer<
  typeof ContestManagementResponseSchema
>;
