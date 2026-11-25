import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { SportLeagueSeasonDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { seasonsNeedingDatesText } from './league-structure-rows';
import { SlotDatesNotice } from './slot-dates-notice';

const season = (name: string, slotsNeedingDates: number) => ({ name, slotsNeedingDates });

/** The notice over a cache already holding the league's Seasons. */
function renderNotice(seasons: Array<Pick<SportLeagueSeasonDto, 'name' | 'slotsNeedingDates'>>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(QueryKeys.sportLeagues.seasons('league-1'), seasons);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  return render(<SlotDatesNotice sportLeagueId="league-1" structurePath="/manage/sports/football/leagues/league-1/structure" />, { wrapper });
}

describe('seasonsNeedingDatesText', () => {
  it('names each Season with slots that need dates and how many, in the order given, and nothing when none do', () => {
    expect(seasonsNeedingDatesText([season('2027-28', 2), season('2026-27', 0), season('2025-26', 1)])).toBe('2027-28 (2), 2025-26 (1)');
    expect(seasonsNeedingDatesText([season('2026-27', 0)])).toBeNull();
  });
});

describe('SlotDatesNotice', () => {
  it('warns while a Season has slots that need dates, naming it, with a link to the Structure tab', () => {
    renderNotice([season('2027-28', 2)]);

    expect(screen.getByTestId('root-admin-league-slot-dates-notice')).toHaveTextContent('2027-28 (2)');
    expect(screen.getByTestId('root-admin-league-slot-dates-open')).toHaveAttribute('href', '/manage/sports/football/leagues/league-1/structure');
  });

  it('shows nothing once no Season has slots that need dates', () => {
    renderNotice([season('2026-27', 0)]);

    expect(screen.queryByTestId('root-admin-league-slot-dates-notice')).not.toBeInTheDocument();
  });
});
