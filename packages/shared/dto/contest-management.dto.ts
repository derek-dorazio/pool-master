import { z } from 'zod';
import {
  AggregationDefinitionIdSchema,
  ContestStatus,
  ContestType,
  ParticipantScoringDefinitionIdSchema,
  SelectionType,
} from '@poolmaster/shared/domain';

export const ContestPrizePayoutTypeSchema = z.enum([
  'FIXED_AMOUNT',
  'PERCENTAGE',
]);
export type ContestPrizePayoutType = z.infer<
  typeof ContestPrizePayoutTypeSchema
>;

export const ParticipantContestScoringRuleRequestSchema = z.object({
  participantScoringDefinitionId: ParticipantScoringDefinitionIdSchema.describe('Scoring definition applied to each participant within the contest.'),
  sortOrder: z.number().int().min(0).describe('Evaluation order for participant scoring rules.'),
  config: z.record(z.unknown()).default({}).describe('Rule-specific configuration payload consumed by the scoring engine.'),
  active: z.boolean().default(true).describe('Whether the scoring rule is currently active.'),
}).describe('Participant-level scoring rule supplied when configuring a managed contest.');
export type ParticipantContestScoringRuleRequest = z.infer<
  typeof ParticipantContestScoringRuleRequestSchema
>;

export const ContestEntryAggregationRuleRequestSchema = z.object({
  aggregationDefinitionId: AggregationDefinitionIdSchema.describe('Aggregation strategy used to convert participant scores into an entry score.'),
  config: z.record(z.unknown()).default({}).describe('Aggregation-rule configuration payload.'),
  active: z.boolean().default(true).describe('Whether the aggregation rule is active.'),
}).describe('Contest-entry aggregation rule for managed-contest configuration.');
export type ContestEntryAggregationRuleRequest = z.infer<
  typeof ContestEntryAggregationRuleRequestSchema
>;

export const ContestPrizeDefinitionRequestSchema = z.object({
  prizeDefinitionId: z.string().min(1).describe('Stable prize-definition identifier.'),
  displayName: z.string().min(1).max(100).describe('Commissioner-facing display name for the prize.'),
  sortOrder: z.number().int().min(0).describe('Display and evaluation order for the prize definition.'),
  ruleConfig: z.record(z.unknown()).default({}).describe('Prize-award rule configuration payload.'),
  payoutType: ContestPrizePayoutTypeSchema.optional().describe('How the prize amount should be interpreted when a payout is attached.'),
  amount: z.number().min(0).optional().describe('Fixed payout amount when payoutType is FIXED_AMOUNT.'),
  percentage: z.number().min(0).max(100).optional().describe('Prize-pool percentage when payoutType is PERCENTAGE.'),
  active: z.boolean().default(true).describe('Whether the prize definition is currently active.'),
}).describe('Prize definition used by contest-management endpoints.');
export type ContestPrizeDefinitionRequest = z.infer<
  typeof ContestPrizeDefinitionRequestSchema
>;

export const ContestConfigurationTierRequestSchema = z.object({
  tierId: z.string().min(1).describe('Stable tier identifier.'),
  tierName: z.string().min(1).describe('Commissioner-facing tier label.'),
  tierNumber: z.number().int().min(1).describe('Ordered tier number used in draft and selection UX.'),
  picksFromTier: z.number().int().min(1).describe('How many selections each entry must make from the tier.'),
  participantIds: z.array(z.string().min(1)).describe('Participants assigned to the tier.'),
}).describe('Tier definition supplied for tiered contests.');
export type ContestConfigurationTierRequest = z.infer<
  typeof ContestConfigurationTierRequestSchema
>;

export const ContestConfigurationRequestSchema = z.object({
  selectionType: z.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
  ]),
  rounds: z.number().int().min(1).optional(),
  timePerPickSeconds: z.number().int().min(10).optional(),
  autoPickPolicy: z.string().min(1).optional(),
  tierConfig: z.array(ContestConfigurationTierRequestSchema).optional(),
  budget: z.number().min(0).optional(),
  pricingMethod: z.string().min(1).optional(),
  pickCount: z.number().int().min(1).optional(),
  isExclusive: z.boolean().optional(),
  picksPerPeriod: z.number().int().min(1).optional(),
  roundValues: z.array(z.number()).optional(),
  startRound: z.string().min(1).optional(),
  locksAt: z.string().datetime().nullable().optional(),
  minimumEntries: z.number().int().min(0).optional(),
  maxEntriesPerSquad: z.number().int().min(1).optional(),
  rosterSize: z.number().int().min(1).optional(),
  totalPrizePoolAmount: z.number().min(0).nullable().optional(),
  participantScoringRules: z.array(ParticipantContestScoringRuleRequestSchema),
  entryAggregationRule: ContestEntryAggregationRuleRequestSchema,
  prizeDefinitions: z.array(ContestPrizeDefinitionRequestSchema).default([]).describe('Prize definitions attached to the contest configuration.'),
}).describe('Managed contest-configuration payload.');
export type ContestConfigurationRequest = z.infer<
  typeof ContestConfigurationRequestSchema
>;

export const CreateContestManagementRequestSchema = z.object({
  name: z.string().min(1).max(100).describe('Contest name shown to commissioners and members.'),
  sportEventId: z.string().uuid().describe('Sport-event identifier that anchors the contest.'),
  contestType: z.enum([ContestType.SINGLE_EVENT]).default(ContestType.SINGLE_EVENT),
  configuration: ContestConfigurationRequestSchema,
}).describe('Commissioner request payload for creating a managed contest.');
export type CreateContestManagementRequest = z.infer<
  typeof CreateContestManagementRequestSchema
>;

export const UpdateContestConfigurationRequestSchema =
  ContestConfigurationRequestSchema;
export type UpdateContestConfigurationRequest = z.infer<
  typeof UpdateContestConfigurationRequestSchema
>;

export const ParticipantContestScoringRuleDtoSchema =
  ParticipantContestScoringRuleRequestSchema.extend({
    id: z.string().describe('Participant scoring-rule identifier.'),
  }).describe('Persisted participant scoring rule.');
export type ParticipantContestScoringRuleDto = z.infer<
  typeof ParticipantContestScoringRuleDtoSchema
>;

export const ContestEntryAggregationRuleDtoSchema =
  ContestEntryAggregationRuleRequestSchema.extend({
    id: z.string().describe('Contest-entry aggregation-rule identifier.'),
  }).describe('Persisted contest-entry aggregation rule.');
export type ContestEntryAggregationRuleDto = z.infer<
  typeof ContestEntryAggregationRuleDtoSchema
>;

export const ContestPrizeDefinitionDtoSchema =
  ContestPrizeDefinitionRequestSchema.extend({
    id: z.string().describe('Prize-definition record identifier.'),
  }).describe('Persisted contest prize definition.');
export type ContestPrizeDefinitionDto = z.infer<
  typeof ContestPrizeDefinitionDtoSchema
>;

export const ContestConfigurationDtoSchema =
  ContestConfigurationRequestSchema.extend({
    id: z.string().describe('Contest-configuration identifier.'),
    contestId: z.string().describe('Contest that owns the configuration.'),
    participantScoringRules: z.array(ParticipantContestScoringRuleDtoSchema),
    entryAggregationRule: ContestEntryAggregationRuleDtoSchema,
    prizeDefinitions: z.array(ContestPrizeDefinitionDtoSchema),
  }).describe('Persisted managed contest configuration.');
export type ContestConfigurationDto = z.infer<
  typeof ContestConfigurationDtoSchema
>;

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
  createdAt: z.string().datetime().describe('When the contest was created.'),
  updatedAt: z.string().datetime().describe('When the contest was last updated.'),
}).describe('Contest-management detail returned to commissioner tooling.');
export type ContestManagementDetailDto = z.infer<
  typeof ContestManagementDetailDtoSchema
>;

export const ContestManagementResponseSchema = z.object({
  contest: ContestManagementDetailDtoSchema,
}).describe('Managed-contest detail response.');
export type ContestManagementResponse = z.infer<
  typeof ContestManagementResponseSchema
>;
