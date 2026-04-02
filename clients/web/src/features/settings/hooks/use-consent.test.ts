import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useConsent, useUpdateConsent } from './use-consent';

describe('useConsent', () => {
  it('returns consent data from API', async () => {
    const { result } = renderHook(() => useConsent());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    // MSW returns { consents: [] }
    expect(data).toHaveProperty('consents');
    expect(Array.isArray(data.consents)).toBe(true);
  });

  it('returns empty consents array from default MSW handler', async () => {
    const { result } = renderHook(() => useConsent());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data! as any;
    const consents = data.consents as unknown[];
    expect(consents.length).toBe(0);
  });
});

describe('useUpdateConsent', () => {
  it('exposes a mutate function', () => {
    const { result } = renderHook(() => useUpdateConsent());

    expect(result.current.mutate).toBeDefined();
    expect(typeof result.current.mutate).toBe('function');
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useUpdateConsent());

    expect(result.current.isIdle).toBe(true);
    expect(result.current.isPending).toBe(false);
  });
});
