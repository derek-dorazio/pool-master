/**
 * Tier and pricing profile DTOs (#1844): platform-level definitions each sport league names one of
 * (`SportLeagueDto.platformTierProfileId`, `platformPricingProfileId`). Nothing is set per sport. Root admin only.
 */
import { z } from 'zod';
import { BudgetPricingProfileSchema, TierLayoutValuesSchema } from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';
import { registerSchema } from './schema-registry';

const ProfileNameSchema = z.string().trim().min(1).max(50).describe('The profile\'s name, unique among its kind: "6 tiers of 10", "Standard".');
const ProfileCodeSchema = z.string().trim().min(1).max(50).regex(/^[A-Z][A-Z0-9_]*$/, 'Use capital letters, digits and underscores, starting with a letter.')
  .describe('The profile\'s key, unique among its kind: TIERS_6_OF_10, STANDARD. Capital letters, digits and underscores, starting with a letter. Migrations, seed scripts and test data find a profile by it, never by its name.');
const SportLeagueCountSchema = z.number().int().describe('How many sport leagues name the profile. One any league names can\'t be deleted.');

// --- Tier profiles ----------------------------------------------------------

export const PlatformTierProfileWriteRequestSchema = TierLayoutValuesSchema.extend({
  code: ProfileCodeSchema,
  name: ProfileNameSchema,
}).describe('A tier profile\'s code, name and layout, the whole of it. lastTierMax is set exactly when lastTier is CAPPED: 422 PLATFORM_TIER_PROFILE_INVALID otherwise.');
export type PlatformTierProfileWriteRequest = z.infer<typeof PlatformTierProfileWriteRequestSchema>;

export const PlatformTierProfileDtoSchema = PlatformTierProfileWriteRequestSchema.extend({
  id: z.uuid(),
  sportLeagueCount: SportLeagueCountSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A tier layout each sport league can name: a new event of the league starts with tierCount tiers, and auto-tiering fills each tier but the last with tierSize participants in the field\'s order. A field too small to reach the last tier is split evenly over the tiers.');
export type PlatformTierProfileDto = z.infer<typeof PlatformTierProfileDtoSchema>;

export const PlatformTierProfileListResponseSchema = z.object({
  platformTierProfiles: z.array(PlatformTierProfileDtoSchema).describe('Every tier profile, by name.'),
}).describe('Every tier profile.');
export type PlatformTierProfileListResponse = z.infer<typeof PlatformTierProfileListResponseSchema>;

export const PlatformTierProfileResponseSchema = z.object({
  platformTierProfile: PlatformTierProfileDtoSchema,
}).describe('One tier profile.');
export type PlatformTierProfileResponse = z.infer<typeof PlatformTierProfileResponseSchema>;

// --- Pricing profiles -------------------------------------------------------

export const PlatformPricingProfileWriteRequestSchema = BudgetPricingProfileSchema.extend({
  code: ProfileCodeSchema,
  name: ProfileNameSchema,
}).describe('A pricing profile\'s code, name and values, the whole of it. 422 PLATFORM_PRICING_PROFILE_INVALID when the values contradict each other.');
export type PlatformPricingProfileWriteRequest = z.infer<typeof PlatformPricingProfileWriteRequestSchema>;

export const PlatformPricingProfileDtoSchema = PlatformPricingProfileWriteRequestSchema.extend({
  id: z.uuid(),
  sportLeagueCount: SportLeagueCountSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A set of budget pricing values each sport league can name: a synced field of the league never priced before is priced with them, and the price dialog offers them.');
export type PlatformPricingProfileDto = z.infer<typeof PlatformPricingProfileDtoSchema>;

export const PlatformPricingProfileListResponseSchema = z.object({
  platformPricingProfiles: z.array(PlatformPricingProfileDtoSchema).describe('Every pricing profile, by name.'),
}).describe('Every pricing profile.');
export type PlatformPricingProfileListResponse = z.infer<typeof PlatformPricingProfileListResponseSchema>;

export const PlatformPricingProfileResponseSchema = z.object({
  platformPricingProfile: PlatformPricingProfileDtoSchema,
}).describe('One pricing profile.');
export type PlatformPricingProfileResponse = z.infer<typeof PlatformPricingProfileResponseSchema>;

registerSchema('PlatformTierProfileWriteRequest', PlatformTierProfileWriteRequestSchema);
registerSchema('PlatformTierProfileDto', PlatformTierProfileDtoSchema);
registerSchema('PlatformTierProfileListResponse', PlatformTierProfileListResponseSchema);
registerSchema('PlatformTierProfileResponse', PlatformTierProfileResponseSchema);
registerSchema('PlatformPricingProfileWriteRequest', PlatformPricingProfileWriteRequestSchema);
registerSchema('PlatformPricingProfileDto', PlatformPricingProfileDtoSchema);
registerSchema('PlatformPricingProfileListResponse', PlatformPricingProfileListResponseSchema);
registerSchema('PlatformPricingProfileResponse', PlatformPricingProfileResponseSchema);
registerSchema('BudgetPricingProfile', BudgetPricingProfileSchema);
