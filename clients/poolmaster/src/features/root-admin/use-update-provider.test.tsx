import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type * as Logger from '@/lib/logger';
import { bindApiMocks } from '@/test/msw-api';
import { useUpdateProviderLeague, useUpdateProviderSettings } from './use-update-provider';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof Logger>()),
  getLogger: () => ({ child: () => ({ warn }) }),
}));

const refusal = { error: { error: { code: 'PROVIDER_NOT_FOUND', message: 'No such provider.' } }, status: 404 };

bindApiMocks({
  updateProviderSettings: vi.fn().mockResolvedValue(refusal),
  updateProviderLeague: vi.fn().mockResolvedValue(refusal),
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('the provider saves', () => {
  it('logs a refused provider settings save with the provider it was for', async () => {
    const { result } = renderHook(() => useUpdateProviderSettings({ providerId: 'provider-1' }), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({})).rejects.toThrow();
    });

    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'provider.settings.failed', data: { providerId: 'provider-1' } }), 'Provider settings were refused');
  });

  it('logs a refused provider league save with the provider and league it was for', async () => {
    const { result } = renderHook(() => useUpdateProviderLeague({ providerId: 'provider-1', providerLeagueId: 'pl-1' }), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({})).rejects.toThrow();
    });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'provider.league.failed', data: { providerId: 'provider-1', providerLeagueId: 'pl-1' } }),
      'Provider league settings were refused',
    );
  });
});
