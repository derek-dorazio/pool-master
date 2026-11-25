import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { useSportLeagueOverviewsQuery, useSportLeagueQuery } from './use-sport-league-overviews';

const listSportLeagueOverviewsMock = vi.fn();
const getSportLeagueMock = vi.fn();
bindApiMocks({ listSportLeagueOverviews: listSportLeagueOverviewsMock, getSportLeague: getSportLeagueMock });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('the Sports page reads', () => {
  it('fails the overview read when the API refuses it', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ error: { error: { code: 'ROOT_ADMIN_ACCESS_REQUIRED', message: 'Root admins only.' } }, status: 403 });

    const { result } = renderHook(() => useSportLeagueOverviewsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('fails one league\'s read when the API refuses it', async () => {
    getSportLeagueMock.mockResolvedValue({ error: { error: { code: 'SPORT_LEAGUE_NOT_FOUND', message: 'No such league.' } }, status: 404 });

    const { result } = renderHook(() => useSportLeagueQuery('sport-league-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('reads no league while none is open', () => {
    const { result } = renderHook(() => useSportLeagueQuery(null), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getSportLeagueMock).not.toHaveBeenCalled();
  });
});
