import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { useBillingPlan, usePlanTiers, useBillingUsage } from './use-billing';

describe('useBillingPlan', () => {
  it('returns plan data from API', async () => {
    const { result } = renderHook(() => useBillingPlan());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const plan = result.current.data!;
    // MSW returns { slug, name, entitlements }
    expect(plan).toHaveProperty('slug', 'free');
    expect(plan).toHaveProperty('name', 'Free');
    expect(plan).toHaveProperty('entitlements');
  });

  it('returns entitlements with expected shape', async () => {
    const { result } = renderHook(() => useBillingPlan());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const { entitlements } = result.current.data! as any;
    expect(entitlements).toHaveProperty('max_leagues', 50);
    expect(entitlements).toHaveProperty('max_members_per_league', 100);
    expect(entitlements).toHaveProperty('max_contests_per_season', 100);
  });
});

describe('usePlanTiers', () => {
  it('returns plans list from API', async () => {
    const { result } = renderHook(() => usePlanTiers());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    // MSW returns { plans: [...] }
    const plans = data.plans as Array<Record<string, unknown>>;
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBe(1);
  });

  it('includes free plan', async () => {
    const { result } = renderHook(() => usePlanTiers());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    const plans = data.plans as Array<Record<string, unknown>>;
    const slugs = plans.map((p) => p.slug);
    expect(slugs).toContain('free');
  });
});

describe('useBillingUsage', () => {
  it('returns usage data from API', async () => {
    const { result } = renderHook(() => useBillingUsage());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    // MSW returns { usage: [] }
    expect(data).toHaveProperty('usage');
    expect(Array.isArray(data.usage)).toBe(true);
  });

  it('returns populated usage when server provides data', async () => {
    server.use(
      http.get('/api/v1/billing/usage', () => {
        return HttpResponse.json({
          usage: [
            { resource: 'leagues', current: 2, limit: 50 },
            { resource: 'contests', current: 5, limit: 100 },
          ],
        });
      }),
    );

    const { result } = renderHook(() => useBillingUsage());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    const usage = data.usage as Array<Record<string, unknown>>;
    expect(usage.length).toBe(2);
    expect(usage[0]).toHaveProperty('resource', 'leagues');
    expect(typeof usage[0].current).toBe('number');
    expect(usage[0]).toHaveProperty('limit');
  });
});
