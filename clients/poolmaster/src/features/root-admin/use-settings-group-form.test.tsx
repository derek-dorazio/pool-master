import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { Resolver } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { BudgetPricingConfig } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { budgetPricingGroupFixture } from './sport-test-fixtures';
import { useSettingsGroupForm } from './use-settings-group-form';

const passThrough: Resolver<BudgetPricingConfig> = (values) => ({ values, errors: {} });

function renderForm(queryClient: QueryClient) {
  const wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
  return renderHook(() => useSettingsGroupForm({
    group: budgetPricingGroupFixture(),
    resolver: passThrough,
    subject: 'Budget pricing settings',
    toForm: (value: BudgetPricingConfig) => value,
    toValue: (values: BudgetPricingConfig) => values,
  }), { wrapper });
}

describe('useSettingsGroupForm loadLatest', () => {
  const theirs = { ...budgetPricingGroupFixture(), updatedAt: '2026-10-30T01:00:00.000Z', value: { profiles: [budgetPricingGroupFixture().value.profiles[0]] } };

  /** A read cached as a screen would hold it: the first read gives ours, any later one theirs. */
  function cachedRead<T>(queryClient: QueryClient, queryKey: readonly unknown[], ours: T, latest: T) {
    const read = vi.fn<() => T>().mockReturnValueOnce(ours).mockReturnValue(latest);
    return queryClient.query({ queryKey, queryFn: read }).then(() => read);
  }

  it('reads only the one group again when the screen read it alone, even with the list of every group cached', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const readList = await cachedRead(queryClient, QueryKeys.rootAdmin.settings, [budgetPricingGroupFixture()], [theirs]);
    const readGroup = await cachedRead(queryClient, QueryKeys.rootAdmin.settingsGroup('BUDGET_PRICING_CONFIG'), budgetPricingGroupFixture(), theirs);
    const { result } = renderForm(queryClient);

    await act(() => result.current.loadLatest());

    expect(readGroup).toHaveBeenCalledTimes(2);
    expect(readList).toHaveBeenCalledTimes(1);
    expect(result.current.form.getValues().profiles).toHaveLength(1);
  });

  it('reads the list of every group again when that is what the screen holds', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const readList = await cachedRead(queryClient, QueryKeys.rootAdmin.settings, [budgetPricingGroupFixture()], [theirs]);
    const { result } = renderForm(queryClient);

    await act(() => result.current.loadLatest());

    expect(readList).toHaveBeenCalledTimes(2);
    expect(result.current.form.getValues().profiles).toHaveLength(1);
  });
});
