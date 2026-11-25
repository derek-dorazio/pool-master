import { z } from 'zod';
import { LeaguePlan } from '@poolmaster/shared/domain';
import type { CustomerLeagueDto } from '@/lib/api';
import { PREVIEW_EXTEND_MONTHS } from '@/features/plans/preview-extend-months';


export const customerLeagueFormSchema = z.object({
  plan: z.enum(LeaguePlan),
  // "" keeps the preview's end as it is.
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
