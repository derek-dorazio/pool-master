import { waitFor } from '@testing-library/react';
import { renderHook } from '@/test-utils';
import {
  getCurrentPlan,
  getSubscription,
  getUsage,
  listPlans,
} from '@/lib/api';
import {
  useBillingEnabled,
  useBillingPlan,
  useBillingSubscription,
  useBillingUsage,
  usePlanTiers,
} from './use-billing';

vi.mock('@/lib/api', () => ({
  client: {},
  getCurrentPlan: vi.fn(),
  getSubscription: vi.fn(),
  getUsage: vi.fn(),
  listPlans: vi.fn(),
  listInvoices: vi.fn(),
}));

describe('billing hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads billing enabled from the plans list response', async () => {
    vi.mocked(listPlans).mockResolvedValue({
      data: {
        plans: [],
        billingEnabled: true,
      },
      error: null,
    } as any);

    const { result } = renderHook(() => useBillingEnabled());

    await waitFor(() => expect(result.current.data).toBe(true));
  });

  it('maps plan tiers from the shared plan dto', async () => {
    vi.mocked(listPlans).mockResolvedValue({
      data: {
        billingEnabled: true,
        plans: [
          {
            slug: 'league_plus',
            name: 'League Plus',
            monthlyPriceCents: 7900,
            annualPriceCents: 79000,
            entitlements: {
              max_leagues: -1,
              max_members_per_league: 100,
              max_contests_per_season: 50,
              allowed_draft_types: ['SNAKE', 'TIERED'],
              custom_scoring: true,
              history_seasons: -1,
              support_tier: 'DEDICATED',
            },
          },
        ],
      },
      error: null,
    } as any);

    const { result } = renderHook(() => usePlanTiers());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({
      tier: 'league-plus',
      name: 'League Plus',
      price: 79,
      annualPrice: 790,
      features: {
        leagues: null,
        contestsPerLeague: 50,
        membersPerLeague: 100,
        draftTypes: 'Snake, Tiered',
        scoringTemplates: 'Custom',
        supportLevel: 'Dedicated',
        historyRetention: 'Unlimited',
        customScoring: true,
      },
    });
  });

  it('maps the current billing plan from the plan dto', async () => {
    vi.mocked(getCurrentPlan).mockResolvedValue({
      data: {
        slug: 'starter',
        name: 'Starter',
        monthlyPriceCents: 900,
        annualPriceCents: 9000,
        entitlements: {
          max_leagues: 10,
          max_members_per_league: 25,
          max_contests_per_season: 10,
          allowed_draft_types: 'ALL',
          custom_scoring: false,
          history_seasons: 2,
          support_tier: 'EMAIL',
        },
      },
      error: null,
    } as any);

    const { result } = renderHook(() => useBillingPlan());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toMatchObject({
      tier: 'starter',
      name: 'Starter',
      price: 9,
      annualPrice: 90,
      features: {
        leagues: 10,
        contestsPerLeague: 10,
        membersPerLeague: 25,
        draftTypes: 'All',
        scoringTemplates: 'Standard',
        supportLevel: 'Email',
        historyRetention: '2 seasons',
        customScoring: false,
      },
    });
  });

  it('maps usage limits and unlimited values', async () => {
    vi.mocked(getUsage).mockResolvedValue({
      data: {
        usage: {
          leagues: { resource: 'LEAGUES', current: 3, limit: 10, percentage: 30 },
          contests: { resource: 'CONTESTS', current: 5, limit: -1, percentage: 0 },
          members: { resource: 'MEMBERS', current: 12, limit: 50, percentage: 24 },
        },
      },
      error: null,
    } as any);

    const { result } = renderHook(() => useBillingUsage());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual({
      leagues: { current: 3, limit: 10 },
      contests: { current: 5, limit: null },
      members: { current: 12, limit: 50 },
    });
  });

  it('returns null for a free subscription placeholder and maps active subscriptions', async () => {
    vi.mocked(getSubscription).mockResolvedValueOnce({
      data: {
        subscription: {
          id: 'free',
          tenantId: 'tenant-1',
          stripeCustomerId: '',
          stripeSubscriptionId: null,
          planSlug: 'free',
          billingCycle: 'MONTHLY',
          status: 'ACTIVE',
          trialStart: null,
          trialEnd: null,
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date().toISOString(),
          cancelledAt: null,
          cancelAtPeriodEnd: false,
          paymentMethodLast4: null,
          paymentMethodBrand: null,
          currency: 'usd',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      error: null,
    } as any);

    const freeResult = renderHook(() => useBillingSubscription());
    await waitFor(() => expect(freeResult.result.current.data).toBeNull());

    vi.mocked(getSubscription).mockResolvedValueOnce({
      data: {
        subscription: {
          id: 'sub-1',
          tenantId: 'tenant-1',
          stripeCustomerId: 'cus-1',
          stripeSubscriptionId: 'sub-1',
          planSlug: 'pro',
          billingCycle: 'ANNUAL',
          status: 'ACTIVE',
          trialStart: null,
          trialEnd: null,
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date().toISOString(),
          cancelledAt: null,
          cancelAtPeriodEnd: false,
          paymentMethodLast4: '4242',
          paymentMethodBrand: 'visa',
          currency: 'usd',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      error: null,
    } as any);

    const paidResult = renderHook(() => useBillingSubscription());
    await waitFor(() => expect(paidResult.result.current.data).toBeDefined());
    expect(paidResult.result.current.data).toMatchObject({
      tier: 'pro',
      name: 'Pro',
      cycle: 'annual',
      status: 'active',
    });
  });
});
