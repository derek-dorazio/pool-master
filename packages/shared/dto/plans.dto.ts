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
}).describe('What a league on one plan may do, from the current plan settings.');
export type PlanEntitlementsDto = z.infer<typeof PlanEntitlementsDtoSchema>;

export const LeaguePlanListResponseSchema = z.object({
  plans: z.array(PlanEntitlementsDtoSchema).describe('Every plan, lowest first, for comparing them.'),
}).describe('What each league plan allows.');
export type LeaguePlanListResponse = z.infer<typeof LeaguePlanListResponseSchema>;

export const UpdateLeaguePlanRequestSchema = z.object({
  plan: z.nativeEnum(LeaguePlan).describe('The plan to move the league to. It applies at once and costs nothing.'),
}).describe('A league\'s new plan.');
export type UpdateLeaguePlanRequest = z.infer<typeof UpdateLeaguePlanRequestSchema>;

registerSchema('PlanCapsDto', PlanCapsDtoSchema);
registerSchema('PlanEntitlementsDto', PlanEntitlementsDtoSchema);
registerSchema('LeaguePlanListResponse', LeaguePlanListResponseSchema);
registerSchema('UpdateLeaguePlanRequest', UpdateLeaguePlanRequestSchema);
