import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useConsent, useUpdateConsent } from './use-consent';

describe('useConsent', () => {
  it('returns current consent preferences derived from consent history', async () => {
    const { result } = renderHook(() => useConsent());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toEqual({
      marketingEmails: false,
      analytics: false,
      thirdPartyIntegrations: false,
      doNotSell: false,
    });
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
