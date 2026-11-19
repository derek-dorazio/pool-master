import { z } from 'zod';
import { LEAGUE_PLANS, type LeaguePlan } from '@poolmaster/shared/domain';
import type { CustomerLeagueDto } from '@/lib/api';

/** How far Edit can move a league's Premium preview, in months from today; "" keeps it (#986). */
export const PREVIEW_EXTEND_MONTHS = [1, 3, 6, 12] as const;

export const customerLeagueFormSchema = z.object({
  plan: z.enum(LEAGUE_PLANS as [LeaguePlan, ...LeaguePlan[]]),
  extendMonths: z.enum(['', ...PREVIEW_EXTEND_MONTHS.map(String)] as [string, ...string[]]),
});
export type CustomerLeagueFormValues = z.infer<typeof customerLeagueFormSchema>;

export function customerLeagueFormValues(league: CustomerLeagueDto): CustomerLeagueFormValues {
  return { plan: league.plan, extendMonths: '' };
}

/** What a Save changes: the plan when it moved, and the preview when a month count was picked. */
export type CustomerLeagueChange = { plan: LeaguePlan | null; extendMonths: number | null };

export function customerLeagueChange(league: CustomerLeagueDto, values: CustomerLeagueFormValues): CustomerLeagueChange {
  return {
    plan: values.plan === league.plan ? null : values.plan,
    extendMonths: values.extendMonths === '' ? null : Number(values.extendMonths),
  };
}
