import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { usePlatformPricingProfilesQuery, usePlatformTierProfilesQuery } from './use-profiles';

const listPlatformTierProfilesMock = vi.fn();
const listPlatformPricingProfilesMock = vi.fn();
bindApiMocks({ listPlatformTierProfiles: listPlatformTierProfilesMock, listPlatformPricingProfiles: listPlatformPricingProfilesMock });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

const refusal = { error: { error: { code: 'ROOT_ADMIN_ACCESS_REQUIRED', message: 'Root admins only.' } }, status: 403 };

describe('the platform profile reads', () => {
  it('fails the tier profiles read when the API refuses it', async () => {
    listPlatformTierProfilesMock.mockResolvedValue(refusal);

    const { result } = renderHook(() => usePlatformTierProfilesQuery(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('fails the pricing profiles read when the API refuses it', async () => {
    listPlatformPricingProfilesMock.mockResolvedValue(refusal);

    const { result } = renderHook(() => usePlatformPricingProfilesQuery(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
