import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useBillingPlan, usePlanTiers, useBillingUsage } from './use-billing';

describe('useBillingPlan', () => {
  it('returns plan data', async () => {
    const { result } = renderHook(() => useBillingPlan());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const plan = result.current.data!;
    expect(plan).toHaveProperty('tier');
    expect(plan).toHaveProperty('name');
    expect(plan).toHaveProperty('price');
    expect(plan).toHaveProperty('annualPrice');
    expect(plan).toHaveProperty('features');
  });

  it('returns plan features with expected shape', async () => {
    const { result } = renderHook(() => useBillingPlan());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const { features } = result.current.data!;
    expect(features).toHaveProperty('leagues');
    expect(features).toHaveProperty('contestsPerLeague');
    expect(features).toHaveProperty('membersPerLeague');
    expect(features).toHaveProperty('draftTypes');
    expect(features).toHaveProperty('scoringTemplates');
    expect(features).toHaveProperty('supportLevel');
    expect(features).toHaveProperty('historyRetention');
    expect(features).toHaveProperty('customScoring');
  });
});

describe('usePlanTiers', () => {
  it('returns tier list', async () => {
    const { result } = renderHook(() => usePlanTiers());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const tiers = result.current.data!;
    expect(Array.isArray(tiers)).toBe(true);
    expect(tiers.length).toBe(4);
  });

  it('includes free and paid tiers', async () => {
    const { result } = renderHook(() => usePlanTiers());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const tierNames = result.current.data!.map((t) => t.tier);
    expect(tierNames).toContain('free');
    expect(tierNames).toContain('starter');
    expect(tierNames).toContain('pro');
    expect(tierNames).toContain('league-plus');
  });
});

describe('useBillingUsage', () => {
  it('returns usage stats', async () => {
    const { result } = renderHook(() => useBillingUsage());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const usage = result.current.data!;
    expect(usage).toHaveProperty('leagues');
    expect(usage).toHaveProperty('contests');
    expect(usage).toHaveProperty('members');
  });

  it('returns usage entries with current and limit', async () => {
    const { result } = renderHook(() => useBillingUsage());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const { leagues } = result.current.data!;
    expect(typeof leagues.current).toBe('number');
    expect(leagues).toHaveProperty('limit');
  });
});
