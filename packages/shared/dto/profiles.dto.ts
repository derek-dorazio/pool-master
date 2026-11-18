/**
 * Tier and pricing profile DTOs (#1844): platform-level definitions each sport league names one of
 * (`SportLeagueDto.tierProfileId`, `pricingProfileId`). Nothing is set per sport. Root admin only.
 */
import { z } from 'zod';
import { BudgetPricingProfileSchema, TierLayoutValuesSchema } from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';
import { registerSchema } from './schema-registry';

const ProfileNameSchema = z.string().trim().min(1).max(50).describe('The profile\'s name, unique among its kind: "6 tiers of 10", "Standard".');
const SportLeagueCountSchema = z.number().int().describe('How many sport leagues name the profile. One any league names can\'t be deleted.');

// --- Tier profiles ----------------------------------------------------------

export const TierProfileWriteRequestSchema = TierLayoutValuesSchema.extend({
  name: ProfileNameSchema,
}).describe('A tier profile\'s name and layout, the whole of it. lastTierMax is set exactly when lastTier is CAPPED: 422 TIER_PROFILE_INVALID otherwise.');
export type TierProfileWriteRequest = z.infer<typeof TierProfileWriteRequestSchema>;

export const TierProfileDtoSchema = TierProfileWriteRequestSchema.extend({
  id: z.uuid(),
  sportLeagueCount: SportLeagueCountSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A tier layout each sport league can name: a new event of the league starts with tierCount tiers, and auto-tiering fills each tier but the last with tierSize participants in the field\'s order. A field too small to reach the last tier is split evenly over the tiers.');
export type TierProfileDto = z.infer<typeof TierProfileDtoSchema>;

export const TierProfileListResponseSchema = z.object({
  tierProfiles: z.array(TierProfileDtoSchema).describe('Every tier profile, by name.'),
}).describe('Every tier profile.');
export type TierProfileListResponse = z.infer<typeof TierProfileListResponseSchema>;

export const TierProfileResponseSchema = z.object({
  tierProfile: TierProfileDtoSchema,
}).describe('One tier profile.');
export type TierProfileResponse = z.infer<typeof TierProfileResponseSchema>;

// --- Pricing profiles -------------------------------------------------------

export const PricingProfileWriteRequestSchema = BudgetPricingProfileSchema.extend({
  name: ProfileNameSchema,
}).describe('A pricing profile\'s name and values, the whole of it. 422 PRICING_PROFILE_INVALID when the values contradict each other.');
export type PricingProfileWriteRequest = z.infer<typeof PricingProfileWriteRequestSchema>;

export const PricingProfileDtoSchema = PricingProfileWriteRequestSchema.extend({
  id: z.uuid(),
  sportLeagueCount: SportLeagueCountSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A set of budget pricing values each sport league can name: a synced field of the league never priced before is priced with them, and the price dialog offers them.');
export type PricingProfileDto = z.infer<typeof PricingProfileDtoSchema>;

export const PricingProfileListResponseSchema = z.object({
  pricingProfiles: z.array(PricingProfileDtoSchema).describe('Every pricing profile, by name.'),
}).describe('Every pricing profile.');
export type PricingProfileListResponse = z.infer<typeof PricingProfileListResponseSchema>;

export const PricingProfileResponseSchema = z.object({
  pricingProfile: PricingProfileDtoSchema,
}).describe('One pricing profile.');
export type PricingProfileResponse = z.infer<typeof PricingProfileResponseSchema>;

registerSchema('TierProfileWriteRequest', TierProfileWriteRequestSchema);
registerSchema('TierProfileDto', TierProfileDtoSchema);
registerSchema('TierProfileListResponse', TierProfileListResponseSchema);
registerSchema('TierProfileResponse', TierProfileResponseSchema);
registerSchema('PricingProfileWriteRequest', PricingProfileWriteRequestSchema);
registerSchema('PricingProfileDto', PricingProfileDtoSchema);
registerSchema('PricingProfileListResponse', PricingProfileListResponseSchema);
registerSchema('PricingProfileResponse', PricingProfileResponseSchema);
registerSchema('BudgetPricingProfile', BudgetPricingProfileSchema);
