import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useConsent, useUpdateConsent } from './use-consent';

const getConsentHistory = vi.fn();
const recordConsent = vi.fn();

vi.mock('@/lib/api', () => ({
  client: {},
  getConsentHistory: (...args: unknown[]) => getConsentHistory(...args),
  recordConsent: (...args: unknown[]) => recordConsent(...args),
}));

describe('useConsent', () => {
  beforeEach(() => {
    getConsentHistory.mockResolvedValue({
      data: {
        consents: [],
      },
      error: null,
    });
  });

  it('returns current consent preferences derived from consent history', async () => {
    const { result } = renderHook(() => useConsent());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(getConsentHistory).toHaveBeenCalledWith(expect.objectContaining({ client: expect.anything() }));

    expect(result.current.data).toEqual({
      marketingEmails: false,
      analytics: false,
      thirdPartyIntegrations: false,
      doNotSell: false,
    });
  });
});

describe('useUpdateConsent', () => {
  beforeEach(() => {
    recordConsent.mockResolvedValue({ error: null });
  });

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

  it('records consent through the generated SDK function', async () => {
    const { result } = renderHook(() => useUpdateConsent());

    result.current.mutate({ analytics: true });

    await waitFor(() => {
      expect(recordConsent).toHaveBeenCalledWith(expect.objectContaining({
        client: expect.anything(),
        body: expect.objectContaining({
          consentType: 'analytics_cookies',
          granted: true,
          version: '1.0',
        }),
      }));
    });
  });
});
