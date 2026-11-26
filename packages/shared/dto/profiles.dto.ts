/**
 * Tier and pricing profile DTOs (#1844): platform-level definitions each sport league names one of
 * (`SportLeagueDto.platformTierProfileId`, `platformPricingProfileId`). Nothing is set per sport. Root admin only.
 */
import { z } from 'zod';
import { BudgetPricingProfileSchema, EqualGroupsLayoutSchema, ProfileSourcesSchema, RangesLayoutSchema } from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';
import { registerSchema } from './schema-registry';

const ProfileNameSchema = z.string().trim().min(1).max(50).describe('The root admin\'s name for the profile, unique among its kind: "6 tiers of 10", "Standard". Screens read the display strings keyed by the code, and show this only for a profile whose strings are not seeded yet.');
const ProfileCodeSchema = z.string().trim().min(1).max(50).regex(/^[A-Z][A-Z0-9_]*$/, 'Use capital letters, digits and underscores, starting with a letter.')
  .describe('The profile\'s key, unique among its kind: TIERS_6_OF_10, STANDARD. Capital letters, digits and underscores, starting with a letter. Migrations, seed scripts and test data find a profile by it, never by its name.');
const ProfileDescriptionSchema = z.string().trim().min(1, 'Say what the profile is for.').max(500)
  .describe('Plain English for agents and root admins: what the profile is and why it exists. Not shown to commissioners or members, who read the display strings keyed by the code (tierProfile.<CODE>.name, pricingProfile.<CODE>.name).');
const SportLeagueCountSchema = z.number().int().describe('How many sport leagues name the profile. One any league names can\'t be deleted.');

// --- Tier profiles ----------------------------------------------------------

const TierProfileIdentity = { code: ProfileCodeSchema, name: ProfileNameSchema, description: ProfileDescriptionSchema, sources: ProfileSourcesSchema };
const SavedProfile = { id: z.uuid(), sportLeagueCount: SportLeagueCountSchema, createdAt: DateTimeSchema, updatedAt: DateTimeSchema };

export const PlatformTierProfileWriteRequestSchema = z.discriminatedUnion('type', [
  EqualGroupsLayoutSchema.extend(TierProfileIdentity),
  RangesLayoutSchema.extend(TierProfileIdentity),
]).describe('A tier profile\'s code, name, description, sources and layout, the whole of it. 422 PLATFORM_TIER_PROFILE_INVALID when the layout can\'t be used: on EQUAL_GROUPS, lastTierMax set other than exactly when lastTier is CAPPED; on RANGES, ranges out of tier order, with a gap or an overlap, open before the last tier, or ordered by ODDS first. 422 PROFILE_FIRST_SOURCES_DIFFER when a changed first source no longer matches the pricing profile of a sport league that names this one.');
export type PlatformTierProfileWriteRequest = z.infer<typeof PlatformTierProfileWriteRequestSchema>;

export const PlatformTierProfileDtoSchema = z.discriminatedUnion('type', [
  EqualGroupsLayoutSchema.extend(TierProfileIdentity).extend(SavedProfile),
  RangesLayoutSchema.extend(TierProfileIdentity).extend(SavedProfile),
]).describe('A tier layout each sport league can name: a new event of the league starts with its tiers, and auto-tiering puts the field in order by the profile\'s sources, then fills the tiers: EQUAL_GROUPS, tierSize in each tier but the last (a field too small to reach the last tier is split evenly); RANGES, each participant in the tier whose range holds their seed or rank.');
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
  description: ProfileDescriptionSchema,
  sources: ProfileSourcesSchema,
}).describe('A pricing profile\'s code, name, description, sources and values, the whole of it. 422 PLATFORM_PRICING_PROFILE_INVALID when the values contradict each other; 422 PROFILE_FIRST_SOURCES_DIFFER when a changed first source no longer matches the tier profile of a sport league that names this one.');
export type PlatformPricingProfileWriteRequest = z.infer<typeof PlatformPricingProfileWriteRequestSchema>;

export const PlatformPricingProfileDtoSchema = PlatformPricingProfileWriteRequestSchema.extend({
  id: z.uuid(),
  sportLeagueCount: SportLeagueCountSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A set of budget pricing values each sport league can name: a synced field of the league never priced before is put in order by its sources and priced with its values, and the price dialog offers them.');
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
