import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { sportsQueryClient } from './sport-test-fixtures';
import { useManagedSport, useManagedSportParam } from './use-managed-sport';

// The sport a /manage/sports/:sport address names, found by its stored URL segment.

function wrapperAt(path: string, queryClient = sportsQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={children} path="/manage/sports/:sport/*" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

describe('useManagedSportParam', () => {
  it('finds the sport by its stored URL segment', () => {
    const { result } = renderHook(() => useManagedSportParam(), { wrapper: wrapperAt('/manage/sports/football/leagues') });

    expect(result.current.managed).toEqual({ sport: 'FOOTBALL', sportUrlSegment: 'football' });
  });

  it('finds no sport for a segment no sport has', () => {
    const { result } = renderHook(() => useManagedSportParam(), { wrapper: wrapperAt('/manage/sports/quidditch/leagues') });

    expect(result.current.managed).toBeNull();
  });

  it('finds no sport while the sports have not loaded', () => {
    const notLoaded = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    const { result } = renderHook(() => useManagedSportParam(), { wrapper: wrapperAt('/manage/sports/golf/leagues', notLoaded) });

    expect(result.current.managed).toBeNull();
  });
});

describe('useManagedSport', () => {
  it('gives the sport of the page being shown', () => {
    const { result } = renderHook(() => useManagedSport(), { wrapper: wrapperAt('/manage/sports/golf/events') });

    expect(result.current).toEqual({ sport: 'GOLF', sportUrlSegment: 'golf' });
  });

  it('throws for an address that names no sport, since only a found sport\'s pages call it', () => {
    expect(() => renderHook(() => useManagedSport(), { wrapper: wrapperAt('/manage/sports/quidditch/leagues') }))
      .toThrow('useManagedSport is only available under a /manage/sports/:sport route.');
  });
});
