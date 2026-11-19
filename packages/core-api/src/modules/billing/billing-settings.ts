/**
 * BILLING_CONFIG (#987): whether payments are on, each plan's subscription price (#1885) and
 * each plan's expansion price list (plans/payments.md §3, §9). Root admins change it on the
 * Pricing page; the contest expansion service reads it on every call.
 */

import { BillingConfigSchema, type BillingConfig } from '@poolmaster/shared/dto';
import { LEAGUE_PLANS } from '@poolmaster/shared/domain';
import { defineSettingsGroup } from '../platform/settings-group';
import { PublicReadPath } from '../../core/public-cache';

/** The stored shape, plus what a JSON schema can't say: each list's bands and prices rise. */
const BillingSettingsSchema = BillingConfigSchema.superRefine((config, context) => {
  for (const plan of LEAGUE_PLANS) {
    config.expansionPrices[plan].forEach((band, index, bands) => {
      if (index === 0) return;
      const below = bands[index - 1];
      if (band.entriesPerContest <= below.entriesPerContest) {
        context.addIssue({
          code: 'custom',
          path: ['expansionPrices', plan, index, 'entriesPerContest'],
          message: `${plan}'s bands must rise: ${band.entriesPerContest} entries is not above ${below.entriesPerContest}.`,
        });
      }
      if (band.priceCents <= below.priceCents) {
        context.addIssue({
          code: 'custom',
          path: ['expansionPrices', plan, index, 'priceCents'],
          message: `${plan}'s prices must rise with the band, so a step up always costs something.`,
        });
      }
    });
  }
});

/** Derek's price lists (2026-10-24, plans/payments.md §3), in US cents. */
const dollars = (entriesPerContest: number, price: number) => ({ entriesPerContest, priceCents: price * 100 });

export const BILLING_SETTINGS = defineSettingsGroup<BillingConfig>({
  key: 'BILLING_CONFIG',
  title: 'Payments',
  description: 'Whether payments are on, what each plan costs, and what expanding a contest costs on each plan.',
  // The public Plans page reads this group (`listLeaguePlans`).
  publicReads: [PublicReadPath.PLANS],
  schema: BillingSettingsSchema,
  defaults: () => ({
    paymentsEnabled: false,
    // Every plan free until Derek sets real prices (#1885); nothing charges them yet.
    planPrices: {
      FREE: { yearlyCents: 0, monthlyCents: 0 },
      PRO: { yearlyCents: 0, monthlyCents: 0 },
      PREMIUM: { yearlyCents: 0, monthlyCents: 0 },
      PLATINUM: { yearlyCents: 0, monthlyCents: 0 },
    },
    expansionPrices: {
      FREE: [dollars(50, 10), dollars(100, 20), dollars(200, 30), dollars(500, 40)],
      PRO: [dollars(100, 15), dollars(200, 20), dollars(500, 30)],
      PREMIUM: [dollars(200, 15), dollars(500, 20), dollars(1000, 30)],
      PLATINUM: [dollars(1000, 30), dollars(2000, 40)],
    },
  }),
});
