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
  participantScoringDefinitionId: ParticipantScoringDefinitionIdSchema,
  sortOrder: z.number().int().min(0),
  config: z.record(z.unknown()).default({}),
  active: z.boolean().default(true),
});
export type ParticipantContestScoringRuleRequest = z.infer<
  typeof ParticipantContestScoringRuleRequestSchema
>;

export const ContestEntryAggregationRuleRequestSchema = z.object({
  aggregationDefinitionId: AggregationDefinitionIdSchema,
  config: z.record(z.unknown()).default({}),
  active: z.boolean().default(true),
});
export type ContestEntryAggregationRuleRequest = z.infer<
  typeof ContestEntryAggregationRuleRequestSchema
>;

export const ContestPrizeDefinitionRequestSchema = z.object({
  prizeDefinitionId: z.string().min(1),
  displayName: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
  ruleConfig: z.record(z.unknown()).default({}),
  payoutType: ContestPrizePayoutTypeSchema.optional(),
  amount: z.number().min(0).optional(),
  percentage: z.number().min(0).max(100).optional(),
  active: z.boolean().default(true),
});
export type ContestPrizeDefinitionRequest = z.infer<
  typeof ContestPrizeDefinitionRequestSchema
>;

export const ContestConfigurationTierRequestSchema = z.object({
  tierId: z.string().min(1),
  tierName: z.string().min(1),
  tierNumber: z.number().int().min(1),
  picksFromTier: z.number().int().min(1),
  participantIds: z.array(z.string().min(1)),
});
export type ContestConfigurationTierRequest = z.infer<
  typeof ContestConfigurationTierRequestSchema
>;

export const ContestConfigurationRequestSchema = z.object({
  selectionType: z.enum([
    SelectionType.SNAKE_DRAFT,
    SelectionType.TIERED,
    SelectionType.BUDGET_PICK,
    SelectionType.OPEN_SELECTION,
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
  prizeDefinitions: z.array(ContestPrizeDefinitionRequestSchema).default([]),
});
export type ContestConfigurationRequest = z.infer<
  typeof ContestConfigurationRequestSchema
>;

export const CreateContestManagementRequestSchema = z.object({
  name: z.string().min(1).max(100),
  sportEventId: z.string().uuid(),
  contestType: z.enum([ContestType.SINGLE_EVENT]).default(ContestType.SINGLE_EVENT),
  configuration: ContestConfigurationRequestSchema,
});
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
    id: z.string(),
  });
export type ParticipantContestScoringRuleDto = z.infer<
  typeof ParticipantContestScoringRuleDtoSchema
>;

export const ContestEntryAggregationRuleDtoSchema =
  ContestEntryAggregationRuleRequestSchema.extend({
    id: z.string(),
  });
export type ContestEntryAggregationRuleDto = z.infer<
  typeof ContestEntryAggregationRuleDtoSchema
>;

export const ContestPrizeDefinitionDtoSchema =
  ContestPrizeDefinitionRequestSchema.extend({
    id: z.string(),
  });
export type ContestPrizeDefinitionDto = z.infer<
  typeof ContestPrizeDefinitionDtoSchema
>;

export const ContestConfigurationDtoSchema =
  ContestConfigurationRequestSchema.extend({
    id: z.string(),
    contestId: z.string(),
    participantScoringRules: z.array(ParticipantContestScoringRuleDtoSchema),
    entryAggregationRule: ContestEntryAggregationRuleDtoSchema,
    prizeDefinitions: z.array(ContestPrizeDefinitionDtoSchema),
  });
export type ContestConfigurationDto = z.infer<
  typeof ContestConfigurationDtoSchema
>;

export const ContestManagementDetailDtoSchema = z.object({
  id: z.string(),
  leagueId: z.string(),
  sportEventId: z.string(),
  name: z.string(),
  status: z.enum([
    ContestStatus.DRAFT,
    ContestStatus.OPEN,
    ContestStatus.DRAFTING,
    ContestStatus.LOCKED,
    ContestStatus.ACTIVE,
    ContestStatus.COMPLETED,
    ContestStatus.CANCELLED,
  ]),
  configuration: ContestConfigurationDtoSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContestManagementDetailDto = z.infer<
  typeof ContestManagementDetailDtoSchema
>;

export const ContestManagementResponseSchema = z.object({
  contest: ContestManagementDetailDtoSchema,
});
export type ContestManagementResponse = z.infer<
  typeof ContestManagementResponseSchema
>;
