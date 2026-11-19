import { BILLING_SETTINGS } from '../../../packages/core-api/src/modules/billing/billing-settings';
import { contestExpansionOffers } from '../../../packages/core-api/src/modules/billing/contest-expansion-offers';
import { AppSettingsService } from '../../../packages/core-api/src/modules/platform/app-settings-service';
import { fakeLogger } from '../../support/fake-logger';
import { inMemoryRuntimeConfigs } from '../../support/in-memory-runtime-configs';

// The Payments settings group and the offers worked out from it (#987, plans/payments.md §3, §4).

const defaults = BILLING_SETTINGS.defaults({});

describe('BILLING_SETTINGS', () => {
  it('starts with payments off, every plan\'s subscription at $0, and Derek\'s price list for each plan, in cents', () => {
    expect(defaults).toEqual({
      paymentsEnabled: false,
      planPrices: {
        FREE: { yearlyCents: 0, monthlyCents: 0 },
        PRO: { yearlyCents: 0, monthlyCents: 0 },
        PREMIUM: { yearlyCents: 0, monthlyCents: 0 },
        PLATINUM: { yearlyCents: 0, monthlyCents: 0 },
      },
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

  it('loads a row saved before plan prices existed, filling every plan\'s price with $0 and keeping the saved price lists', async () => {
    const runtimeConfigs = inMemoryRuntimeConfigs();
    const savedLists = { ...defaults.expansionPrices, PRO: [{ entriesPerContest: 75, priceCents: 1200 }] };
    runtimeConfigs.put('BILLING_CONFIG', { paymentsEnabled: false, expansionPrices: savedLists });
    const settings = new AppSettingsService({ repository: runtimeConfigs, groups: [BILLING_SETTINGS], env: {}, logger: fakeLogger() });

    await settings.load();

    expect(settings.getState(BILLING_SETTINGS).source).toBe('stored');
    expect(settings.get(BILLING_SETTINGS).planPrices).toEqual(defaults.planPrices);
    expect(settings.get(BILLING_SETTINGS).expansionPrices).toEqual(savedLists);
  });

  it('loads a row that has prices for some plans only, filling the missing plans with $0', async () => {
    const runtimeConfigs = inMemoryRuntimeConfigs();
    runtimeConfigs.put('BILLING_CONFIG', { ...defaults, planPrices: { PRO: { yearlyCents: 9900, monthlyCents: 999 } } });
    const settings = new AppSettingsService({ repository: runtimeConfigs, groups: [BILLING_SETTINGS], env: {}, logger: fakeLogger() });

    await settings.load();

    expect(settings.get(BILLING_SETTINGS).planPrices).toEqual({ ...defaults.planPrices, PRO: { yearlyCents: 9900, monthlyCents: 999 } });
  });

  it.each([
    ['a negative yearly price', { yearlyCents: -1, monthlyCents: 0 }, 'yearlyCents'],
    ['a monthly price above $10,000', { yearlyCents: 0, monthlyCents: 1_000_001 }, 'monthlyCents'],
    ['a fraction of a cent', { yearlyCents: 999.5, monthlyCents: 0 }, 'yearlyCents'],
  ])('refuses %s, naming the plan and the price', (_label, price, field) => {
    const result = BILLING_SETTINGS.schema.safeParse({ ...defaults, planPrices: { ...defaults.planPrices, PREMIUM: price } });

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([`planPrices.PREMIUM.${field}`]);
  });

  it('accepts the highest price, $10,000, a year and a month', () => {
    const top = { yearlyCents: 1_000_000, monthlyCents: 1_000_000 };
    expect(BILLING_SETTINGS.schema.safeParse({ ...defaults, planPrices: { ...defaults.planPrices, PLATINUM: top } }).success).toBe(true);
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
