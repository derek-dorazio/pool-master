/**
 * League plan DTOs (#945): what a plan allows, as a league carries it and as the plan comparison
 * lists it. Both come from core-api's plan entitlements service, so the app never works out a
 * plan's caps or features itself.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { LeaguePlan, PlanFeature, type PlanCap } from '../domain/enums';

const PlanLimitSchema = z.number().int().nullable().describe('The most the plan allows, or null for unlimited.');

export const PlanCapsDtoSchema = z.object({
  ENTRIES_PER_CONTEST: PlanLimitSchema.describe('Entries per contest, drafts included, or null for unlimited.'),
  SPORTS_LEAGUES_PER_YEAR: PlanLimitSchema.describe(
    'Different sports leagues among the league\'s contests in a calendar year, or null for unlimited.',
  ),
} satisfies Record<PlanCap, typeof PlanLimitSchema>).describe('Each cap\'s limit on one plan.');
export type PlanCapsDto = z.infer<typeof PlanCapsDtoSchema>;

export const PlanEntitlementsDtoSchema = z.object({
  plan: z.nativeEnum(LeaguePlan).describe('The plan, lowest first: FREE, PRO, PREMIUM, PLATINUM.'),
  caps: PlanCapsDtoSchema,
  features: z.array(z.nativeEnum(PlanFeature)).describe(
    'Every feature the plan has, in `PlanFeature` order. A feature a plan lacks is hidden, never deleted.',
  ),
  commissionerSelectable: z.boolean().describe(
    'Whether a commissioner may move a league to the plan now. False for a plan not offered yet (PLATINUM), which only a root admin may set.',
  ),
}).describe('What a league on one plan may do, from the current plan settings.');
export type PlanEntitlementsDto = z.infer<typeof PlanEntitlementsDtoSchema>;

export const LeaguePlanListResponseSchema = z.object({
  plans: z.array(PlanEntitlementsDtoSchema).describe('Every plan, lowest first, for comparing them.'),
}).describe('What each league plan allows.');
export type LeaguePlanListResponse = z.infer<typeof LeaguePlanListResponseSchema>;

export const ExtendPlanRenewalRequestSchema = z.object({
  months: z.number().int().min(1).max(24).describe('How many months from now the gifted plan runs to.'),
}).describe('How far to extend a gifted plan: its renewal date moves to this many months from now, and never earlier than it is.');
export type ExtendPlanRenewalRequest = z.infer<typeof ExtendPlanRenewalRequestSchema>;

export const ExtendRunningPlanRenewalsResponseSchema = z.object({
  extendedCount: z.number().int().describe('How many leagues\' renewal dates moved: every league whose gift still runs and ended sooner.'),
  renewsAt: z.string().datetime().describe('The renewal date they moved to.'),
}).describe('What extending every running gifted plan did.');
export type ExtendRunningPlanRenewalsResponse = z.infer<typeof ExtendRunningPlanRenewalsResponseSchema>;

export const UpdateLeaguePlanRequestSchema = z.object({
  plan: z.nativeEnum(LeaguePlan).describe('The plan to move the league to. It applies at once and costs nothing.'),
}).describe('A league\'s new plan.');
export type UpdateLeaguePlanRequest = z.infer<typeof UpdateLeaguePlanRequestSchema>;

export const ListSportLeaguesUsedQuerySchema = z.object({
  seasonYear: z.number().int().min(2000).max(9999).describe('The season to count, such as 2026: a contest counts in the season of its first event\'s year.'),
}).describe('Which season\'s sports leagues to list.');
export type ListSportLeaguesUsedQuery = z.infer<typeof ListSportLeaguesUsedQuerySchema>;

export const SportLeaguesUsedResponseSchema = z.object({
  seasonYear: z.number().int().describe('The season counted.'),
  sportLeagueIds: z.array(z.string().uuid()).describe('The different sports leagues of the league\'s contests that season, drafts included. Against the plan\'s `SPORTS_LEAGUES_PER_YEAR` cap, a new contest may always be in one of these, and in another only while there are fewer than the cap.'),
}).describe('The sports leagues a league\'s contests use in one season (#947): what its plan\'s sports leagues a year counts.');
export type SportLeaguesUsedResponse = z.infer<typeof SportLeaguesUsedResponseSchema>;

export const OpenContestUsageDtoSchema = z.object({
  contestId: z.string().uuid(),
  name: z.string().describe('The contest\'s name.'),
  entryCount: z.number().int().min(0).describe('Its entries, drafts included: what the plan\'s `ENTRIES_PER_CONTEST` cap counts.'),
}).describe('One contest still taking entries, with its entries as the entry cap counts them.');
export type OpenContestUsageDto = z.infer<typeof OpenContestUsageDtoSchema>;

export const LeaguePlanUsageResponseSchema = z.object({
  seasonYear: z.number().int().describe('This year, in UTC: the season whose sports leagues are listed.'),
  sportLeagueIds: z.array(z.string().uuid()).describe('The different sports leagues of the league\'s contests this season, drafts included: what the plan\'s `SPORTS_LEAGUES_PER_YEAR` cap counts.'),
  openContests: z.array(OpenContestUsageDtoSchema).describe('Every contest still taking entries, newest first.'),
}).describe('What a league uses of its plan\'s caps now (#972), for the commissioner Plan page.');
export type LeaguePlanUsageResponse = z.infer<typeof LeaguePlanUsageResponseSchema>;

registerSchema('PlanCapsDto', PlanCapsDtoSchema);
registerSchema('PlanEntitlementsDto', PlanEntitlementsDtoSchema);
registerSchema('LeaguePlanListResponse', LeaguePlanListResponseSchema);
registerSchema('UpdateLeaguePlanRequest', UpdateLeaguePlanRequestSchema);
registerSchema('ExtendPlanRenewalRequest', ExtendPlanRenewalRequestSchema);
registerSchema('ExtendRunningPlanRenewalsResponse', ExtendRunningPlanRenewalsResponseSchema);
registerSchema('ListSportLeaguesUsedQuery', ListSportLeaguesUsedQuerySchema);
registerSchema('SportLeaguesUsedResponse', SportLeaguesUsedResponseSchema);
registerSchema('OpenContestUsageDto', OpenContestUsageDtoSchema);
registerSchema('LeaguePlanUsageResponse', LeaguePlanUsageResponseSchema);
