import { BILLING_SETTINGS } from '../../../packages/core-api/src/modules/billing/billing-settings';
import { contestExpansionOffers } from '../../../packages/core-api/src/modules/billing/contest-expansion-offers';

// The Payments settings group and the offers worked out from it (#987, plans/payments.md §3, §4).

const defaults = BILLING_SETTINGS.defaults({});

describe('BILLING_SETTINGS', () => {
  it('starts with payments off and Derek\'s price list for each plan, in cents', () => {
    expect(defaults).toEqual({
      paymentsEnabled: false,
      expansionPrices: {
        FREE: [
          { entriesPerContest: 50, priceCents: 1000 },
          { entriesPerContest: 100, priceCents: 2000 },
          { entriesPerContest: 200, priceCents: 3000 },
          { entriesPerContest: 500, priceCents: 4000 },
        ],
        PRO: [
          { entriesPerContest: 100, priceCents: 1500 },
          { entriesPerContest: 200, priceCents: 2000 },
          { entriesPerContest: 500, priceCents: 3000 },
        ],
        PREMIUM: [
          { entriesPerContest: 200, priceCents: 1500 },
          { entriesPerContest: 500, priceCents: 2000 },
          { entriesPerContest: 1000, priceCents: 3000 },
        ],
        PLATINUM: [
          { entriesPerContest: 1000, priceCents: 3000 },
          { entriesPerContest: 2000, priceCents: 4000 },
        ],
      },
    });
    expect(BILLING_SETTINGS.schema.safeParse(defaults).success).toBe(true);
  });

  it('refuses a price list whose bands or prices do not rise, naming the place', () => {
    const result = BILLING_SETTINGS.schema.safeParse({
      ...defaults,
      expansionPrices: {
        ...defaults.expansionPrices,
        PRO: [{ entriesPerContest: 200, priceCents: 2000 }, { entriesPerContest: 100, priceCents: 2000 }],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'expansionPrices.PRO.1.entriesPerContest',
      'expansionPrices.PRO.1.priceCents',
    ]);
  });
});

describe('contestExpansionOffers', () => {
  const free = defaults.expansionPrices.FREE;

  it('offers every band above the contest\'s cap at its list price when the contest was never expanded', () => {
    expect(contestExpansionOffers(free, 20, null).map((offer) => offer.entriesPerContest)).toEqual([50, 100, 200, 500]);
    expect(contestExpansionOffers(free, 20, null)[1]).toEqual({ entriesPerContest: 100, priceCents: 2000 });
  });

  it('charges a step up the difference from the band bought: 100 to 200 on Free is $10', () => {
    expect(contestExpansionOffers(free, 100, 100)).toEqual([
      { entriesPerContest: 200, priceCents: 1000 },
      { entriesPerContest: 500, priceCents: 2000 },
    ]);
  });

  it('counts a bought band missing from the list as the dearest listed band below it', () => {
    // 300 was given by a root admin; on Free it counts as the $30 band of 200.
    expect(contestExpansionOffers(free, 300, 300)).toEqual([{ entriesPerContest: 500, priceCents: 1000 }]);
  });

  it('offers only bands above the plan\'s cap when that is above the contest\'s expansion', () => {
    expect(contestExpansionOffers(defaults.expansionPrices.PREMIUM, 100, null).map((offer) => offer.entriesPerContest)).toEqual([200, 500, 1000]);
  });

  it('offers nothing to a contest with no limit', () => {
    expect(contestExpansionOffers(free, null, null)).toEqual([]);
  });
});
