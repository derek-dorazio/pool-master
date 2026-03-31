import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useConsent, useUpdateConsent } from './use-consent';

describe('useConsent', () => {
  it('returns consent preferences data', async () => {
    const { result } = renderHook(() => useConsent());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data).toHaveProperty('marketingEmails');
    expect(data).toHaveProperty('analytics');
    expect(data).toHaveProperty('thirdPartyIntegrations');
    expect(data).toHaveProperty('doNotSell');
  });

  it('returns boolean values for each preference', async () => {
    const { result } = renderHook(() => useConsent());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(typeof data.marketingEmails).toBe('boolean');
    expect(typeof data.analytics).toBe('boolean');
    expect(typeof data.thirdPartyIntegrations).toBe('boolean');
    expect(typeof data.doNotSell).toBe('boolean');
  });

  it('falls back to mock data with expected defaults', async () => {
    const { result } = renderHook(() => useConsent());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.analytics).toBe(true);
    expect(data.marketingEmails).toBe(false);
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
