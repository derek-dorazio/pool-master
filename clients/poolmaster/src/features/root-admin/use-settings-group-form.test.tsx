import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { Resolver } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { PlanConfig } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { planGroupFixture } from './sport-test-fixtures';
import { useSettingsGroupForm } from './use-settings-group-form';

const passThrough: Resolver<PlanConfig> = (values) => ({ values, errors: {} });

function renderForm(queryClient: QueryClient) {
  const wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
  return renderHook(() => useSettingsGroupForm({
    group: planGroupFixture(),
    resolver: passThrough,
    subject: 'Plans settings',
    toForm: (value: PlanConfig) => value,
    toValue: (values: PlanConfig) => values,
  }), { wrapper });
}

describe('useSettingsGroupForm loadLatest', () => {
  const ours = planGroupFixture();
  const theirs = {
    ...ours,
    updatedAt: '2026-10-30T01:00:00.000Z',
    value: { ...ours.value, caps: { ...ours.value.caps, ENTRIES_PER_CONTEST: { ...ours.value.caps.ENTRIES_PER_CONTEST, FREE: 10 } } },
  };

  /** A read cached as a screen would hold it: the first read gives ours, any later one theirs. */
  function cachedRead<T>(queryClient: QueryClient, queryKey: readonly unknown[], ours: T, latest: T) {
    const read = vi.fn<() => T>().mockReturnValueOnce(ours).mockReturnValue(latest);
    return queryClient.query({ queryKey, queryFn: read }).then(() => read);
  }

  it('reads only the one group again when the screen read it alone, even with the list of every group cached', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const readList = await cachedRead(queryClient, QueryKeys.rootAdmin.settings, [planGroupFixture()], [theirs]);
    const readGroup = await cachedRead(queryClient, QueryKeys.rootAdmin.settingsGroup('PLAN_CONFIG'), planGroupFixture(), theirs);
    const { result } = renderForm(queryClient);

    await act(() => result.current.loadLatest());

    expect(readGroup).toHaveBeenCalledTimes(2);
    expect(readList).toHaveBeenCalledTimes(1);
    expect(result.current.form.getValues().caps.ENTRIES_PER_CONTEST.FREE).toBe(10);
  });

  it('reads the list of every group again when that is what the screen holds', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const readList = await cachedRead(queryClient, QueryKeys.rootAdmin.settings, [planGroupFixture()], [theirs]);
    const { result } = renderForm(queryClient);

    await act(() => result.current.loadLatest());

    expect(readList).toHaveBeenCalledTimes(2);
    expect(result.current.form.getValues().caps.ENTRIES_PER_CONTEST.FREE).toBe(10);
  });
});
