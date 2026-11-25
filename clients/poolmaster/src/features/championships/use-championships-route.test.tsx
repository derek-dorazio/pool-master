import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useChampionshipsRoute } from './use-championships-route';

const { useLeagueContextMock } = vi.hoisted(() => ({ useLeagueContextMock: vi.fn() }));
vi.mock('@/features/leagues/use-league-context', () => ({ useLeagueContext: useLeagueContextMock }));

function at(path: string) {
  return function wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={children} path="/league/:leagueCode/championships/:year" />
          <Route element={children} path="/league/:leagueCode/championships" />
        </Routes>
      </MemoryRouter>
    );
  };
}

describe('useChampionshipsRoute', () => {
  it('reads the league code and year from the route, and the league from its context', () => {
    useLeagueContextMock.mockReturnValue({ league: { id: 'league-1' }, viewer: { isMember: true } });

    const { result } = renderHook(() => useChampionshipsRoute(), { wrapper: at('/league/BIGDAWGS/championships/2026') });

    expect(useLeagueContextMock).toHaveBeenCalledWith('BIGDAWGS');
    expect(result.current).toMatchObject({ leagueCode: 'BIGDAWGS', leagueId: 'league-1', year: 2026, viewer: { isMember: true } });
  });

  it('gives an empty league id while the league loads, and year 0 when the route names none', () => {
    useLeagueContextMock.mockReturnValue({ league: undefined, viewer: null });

    const { result } = renderHook(() => useChampionshipsRoute(), { wrapper: at('/league/BIGDAWGS/championships') });

    expect(result.current).toMatchObject({ leagueId: '', year: 0 });
  });
});
