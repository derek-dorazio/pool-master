import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContestDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryPage } from './contest-entry-page';
import { bracketContestFixture, bracketLeagueContextFixture } from './test/bracket-fixtures';
import { pickEmContestFixture, pickEmEntryFixture, pickEmWeekFixture } from './test/pick-em-fixtures';
import { squaresContestFixture } from './test/squares-fixtures';

// #1762 — once nothing is left to pick, an entry's pick screen address (a receipt's "Review
// entry" link) lands on the entry opened read-only on the contest page instead.

const { getContestEntryMock, getContestMock, getGamePicksMock, getLeagueMock } = vi.hoisted(() => ({
  getContestEntryMock: vi.fn(),
  getContestMock: vi.fn(),
  getGamePicksMock: vi.fn(),
  getLeagueMock: vi.fn(),
}));

// The pick screen's own reads, for the case where it stays.
bindApiMocks({ getContest: getContestMock, getContestEntry: getContestEntryMock, getGamePicks: getGamePicksMock, getLeague: getLeagueMock });

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, isRootAdmin: false, user: { id: 'user-1', isRootAdmin: false }, clearSession: vi.fn() }),
}));

const STARTED = '2026-01-10T18:00:00.000Z';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPickScreen(contest: ContestDto) {
  getContestMock.mockResolvedValue({ data: { contest } });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/league/BIGDAWGS/contests/contest-1/entries/entry-7']}>
        <Routes>
          <Route element={<ContestEntryPage />} path="/league/:leagueCode/contests/:contestId/entries/:entryId" />
          <Route element={<LocationProbe />} path="/league/:leagueCode/contests/:contestId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const startedEvent = (sportEventId: string) => ({
  sportEventId, sequence: 1, name: sportEventId, startDate: STARTED, endDate: null, status: 'IN_PROGRESS' as const, participantType: null, scoringFamily: null,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('An entry\'s pick screen once nothing is left to pick', () => {
  it('sends a lineup entry\'s pick screen to the entry opened on the contest page once the event is under way', async () => {
    renderPickScreen(bracketContestFixture({
      status: 'ACTIVE', selectionType: 'TIERED', contestFormat: 'ROSTER', sportEvents: [startedEvent('event-1')],
    }));

    expect(await screen.findByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1?entry=entry-7');
  });

  it('sends a bracket entry\'s pick screen to its bracket on the contest page once the bracket is locked', async () => {
    renderPickScreen(bracketContestFixture({ status: 'ACTIVE', sportEvents: [startedEvent('event-1')] }));

    expect(await screen.findByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1?entry=entry-7');
  });

  it('sends a squares entry\'s pick screen to its boxes on the contest page once the game is on', async () => {
    renderPickScreen(squaresContestFixture({ status: 'ACTIVE' }));

    expect(await screen.findByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1?entry=entry-7');
  });

  it('sends a final pick\'em entry\'s pick screen to the contest page', async () => {
    renderPickScreen(pickEmContestFixture({ status: 'COMPLETED', sportEvents: [startedEvent('week-1'), startedEvent('week-2')] }));

    expect(await screen.findByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1?entry=entry-7');
  });

  it('sends a final survivor entry\'s pick screen to the contest page', async () => {
    renderPickScreen(pickEmContestFixture({ status: 'COMPLETED', selectionType: 'SURVIVOR', sportEvents: [startedEvent('week-1')] }));

    expect(await screen.findByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1?entry=entry-7');
  });

  it('keeps a live pick\'em entry on its pick screen until the contest is final, its weeks and rounds being picked one at a time', async () => {
    getGamePicksMock.mockResolvedValue({ data: pickEmWeekFixture() });
    getContestEntryMock.mockResolvedValue({ data: pickEmEntryFixture('entry-7') });
    getLeagueMock.mockResolvedValue({ data: bracketLeagueContextFixture() });
    renderPickScreen(pickEmContestFixture({ status: 'ACTIVE', sportEvents: [startedEvent('week-1'), startedEvent('week-2')] }));

    await screen.findByTestId('pick-em-entry-page');
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();
  });
});
