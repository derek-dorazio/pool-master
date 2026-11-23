import { LEAGUE_PLANS, type LeaguePlan } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { z } from 'zod';
import type { BillingConfig, ExpansionPrice, PlanConfig } from '@/lib/api';
import { formatMoneyCents, formatNumber } from '@/features/shared/ui';

/** The most expansion bands a plan's list holds, as BILLING_CONFIG allows. */
export const MAX_EXPANSION_BANDS = 10;

/** One row of the Pricing page's Plan prices grid (#1886): a plan's subscription and its expansion bands. */
export type PlanPriceRow = {
  plan: LeaguePlan;
  label: string;
  yearlyCents: number;
  monthlyCents: number;
  /** The plan's entries per contest cap from PLAN_CONFIG; null is unlimited. */
  entriesIncluded: number | null;
  bands: readonly ExpansionPrice[];
  /** The bands in a line, such as "50 for $10 · 100 for $20"; "—" when the plan has none. */
  expansions: string;
};

/** A plan's bands in a line: "50 for $10 · 100 for $20", or "—" when it has none. */
export function describeExpansionBands(bands: readonly ExpansionPrice[], locale: string): string {
  return bands.length > 0
    ? bands.map((band) => `${formatNumber(band.entriesPerContest, locale)} for ${formatMoneyCents(band.priceCents, locale)}`).join(' · ')
    : '—';
}

/** A plan's included entries as the grid and dialog show them. */
export function describeEntriesIncluded(entries: number | null, locale: string): string {
  return entries === null ? 'Unlimited' : formatNumber(entries, locale);
}

/** One row per plan, lowest first, from the payments settings and the plan caps. */
export function planPriceRows(billing: BillingConfig, plans: PlanConfig, locale: string): PlanPriceRow[] {
  return LEAGUE_PLANS.map((plan) => ({
    plan,
    label: enumLabel('LeaguePlan', plan),
    yearlyCents: billing.planPrices[plan].yearlyCents,
    monthlyCents: billing.planPrices[plan].monthlyCents,
    entriesIncluded: plans.caps.ENTRIES_PER_CONTEST[plan],
    bands: billing.expansionPrices[plan],
    expansions: describeExpansionBands(billing.expansionPrices[plan], locale),
  }));
}

// Zod 4 uses a schema's `error` for every issue without its own message, so each check names its
// own; the schema's message is left for a blank or non-numeric box.
const dollars = (what: string) => z.number({ error: `Enter ${what}.` })
  .min(0, 'Not below $0.')
  .max(10_000, 'At most $10,000.')
  .multipleOf(0.01, 'Dollars and cents only.');

const BandSchema = z.object({
  entriesPerContest: z.number({ error: 'Enter a number of entries.' }).int('Whole entries only.')
    .min(1, 'At least 1 entry.').max(100_000, 'At most 100,000 entries.'),
  dollars: dollars('a price'),
});

/**
 * One plan's prices in dollars, as the admin types them; saved in cents. Each band and each
 * price must be above the one before, which the server checks too.
 */
export const PlanPriceFormSchema = z.object({
  yearly: dollars('a yearly price'),
  monthly: dollars('a monthly price'),
  bands: z.array(BandSchema).max(MAX_EXPANSION_BANDS, `At most ${String(MAX_EXPANSION_BANDS)} bands.`),
}).superRefine((form, context) => {
  form.bands.forEach((band, index, bands) => {
    if (index === 0) return;
    const below = bands[index - 1];
    if (band.entriesPerContest <= below.entriesPerContest) {
      context.addIssue({ code: 'custom', path: ['bands', index, 'entriesPerContest'], message: `Above ${String(below.entriesPerContest)}, the band before.` });
    }
    if (band.dollars <= below.dollars) {
      context.addIssue({ code: 'custom', path: ['bands', index, 'dollars'], message: 'Above the band before\'s price.' });
    }
  });
});
export type PlanPriceForm = z.infer<typeof PlanPriceFormSchema>;

const toDollars = (cents: number) => cents / 100;
const toCents = (amount: number) => Math.round(amount * 100);

/** One plan's prices and bands from the payments settings, in dollars, as the form edits them. */
export function planPriceForm(config: BillingConfig, plan: LeaguePlan): PlanPriceForm {
  return {
    yearly: toDollars(config.planPrices[plan].yearlyCents),
    monthly: toDollars(config.planPrices[plan].monthlyCents),
    bands: config.expansionPrices[plan].map((band) => ({ entriesPerContest: band.entriesPerContest, dollars: toDollars(band.priceCents) })),
  };
}

/** The whole payments settings with only `plan`'s prices and bands changed, as a save sends them. */
export function withPlanPrices(config: BillingConfig, plan: LeaguePlan, form: PlanPriceForm): BillingConfig {
  return {
    ...config,
    planPrices: { ...config.planPrices, [plan]: { yearlyCents: toCents(form.yearly), monthlyCents: toCents(form.monthly) } },
    expansionPrices: {
      ...config.expansionPrices,
      [plan]: form.bands.map((band) => ({ entriesPerContest: band.entriesPerContest, priceCents: toCents(band.dollars) })),
    },
  };
}
