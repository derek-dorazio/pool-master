import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { useCustomerLeaguesQuery, useCustomerUsersQuery } from './use-customers-query';

const listCustomerLeaguesMock = vi.fn();
const listCustomerUsersMock = vi.fn();
bindApiMocks({ listCustomerLeagues: listCustomerLeaguesMock, listCustomerUsers: listCustomerUsersMock });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

const refusal = { error: { error: { code: 'ROOT_ADMIN_ACCESS_REQUIRED', message: 'Root admins only.' } }, status: 403 };

describe('the Customers reads', () => {
  it('fails the leagues read when the API refuses it', async () => {
    listCustomerLeaguesMock.mockResolvedValue(refusal);

    const { result } = renderHook(() => useCustomerLeaguesQuery(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('fails the users read when the API refuses it', async () => {
    listCustomerUsersMock.mockResolvedValue(refusal);

    const { result } = renderHook(() => useCustomerUsersQuery(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
