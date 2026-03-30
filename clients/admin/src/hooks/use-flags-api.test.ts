import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useFlagList, useFlagDetail } from './use-flags-api';

describe('useFlagList', () => {
  it('returns flags array', async () => {
    const { result } = renderHook(() => useFlagList());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toBeInstanceOf(Array);
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it('each flag has required fields', async () => {
    const { result } = renderHook(() => useFlagList());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const flag = result.current.data[0];
    expect(flag).toHaveProperty('key');
    expect(flag).toHaveProperty('name');
    expect(flag).toHaveProperty('type');
    expect(flag).toHaveProperty('enabled');
    expect(flag).toHaveProperty('rolloutPct');
    expect(flag).toHaveProperty('owner');
  });

  it('returns isLoading state', () => {
    const { result } = renderHook(() => useFlagList());

    expect(typeof result.current.isLoading).toBe('boolean');
  });
});

describe('useFlagDetail', () => {
  it('returns flag details for dark_mode', async () => {
    const { result } = renderHook(() => useFlagDetail('dark_mode'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const data = result.current.data;
    expect(data).toBeDefined();
    expect(data.key).toBe('dark_mode');
    expect(data.name).toBe('Dark Mode');
    expect(data).toHaveProperty('description');
    expect(data).toHaveProperty('overrides');
    expect(data.overrides).toBeInstanceOf(Array);
  });

  it('returns flag details with overrides', async () => {
    const { result } = renderHook(() => useFlagDetail('live_draft_v2'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data;
    expect(data.key).toBe('live_draft_v2');
    expect(data.overrides.length).toBeGreaterThan(0);
    expect(data.overrides[0]).toHaveProperty('tenantName');
    expect(data.overrides[0]).toHaveProperty('override');
    expect(data.overrides[0]).toHaveProperty('reason');
  });

  it('returns isLoading state', () => {
    const { result } = renderHook(() => useFlagDetail('dark_mode'));

    expect(typeof result.current.isLoading).toBe('boolean');
  });
});
