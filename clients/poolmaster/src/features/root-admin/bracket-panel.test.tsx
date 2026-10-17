import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SportEventMatchDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportEventResultsPage } from './root-admin-sport-event-results-page';
import { fieldEntryFixture, participantFixture, sportEventFixture } from './sport-test-fixtures';

// #698: a basketball tournament's results page shows its bracket round by round, chosen by the
// head-to-head family's entry in the admin results registry.

const { getEventMock, getEventBracketMock, listEventParticipantsMock, mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return {
    getEventMock: vi.fn(),
    getEventBracketMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  getEventBracket: getEventBracketMock,
  listEventParticipants: listEventParticipantsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const tournament = sportEventFixture({
  id: 'evt-1',
  sport: 'BASKETBALL',
  name: 'Harbour Classic',
  status: 'SCHEDULED',
  rounds: 2,
  roundsPar: null,
  allowedTransitions: [],
});

const duke = fieldEntryFixture({ id: 'sep-1', participantId: 'p-1', seedNumber: 1, participant: participantFixture({ id: 'p-1', name: 'Duke' }) });
const vermont = fieldEntryFixture({ id: 'sep-2', participantId: 'p-2', seedNumber: 16, participant: participantFixture({ id: 'p-2', name: 'Vermont' }) });
const houston = fieldEntryFixture({ id: 'sep-3', participantId: 'p-3', seedNumber: 2, participant: participantFixture({ id: 'p-3', name: 'Houston' }) });
const texas = fieldEntryFixture({ id: 'sep-4', participantId: 'p-4', seedNumber: 15, participant: participantFixture({ id: 'p-4', name: 'Texas' }) });

function match(overrides: Partial<SportEventMatchDto> & Pick<SportEventMatchDto, 'id' | 'matchNumber' | 'roundNumber'>): SportEventMatchDto {
  return {
    sportEventId: 'evt-1',
    homeSportEventParticipantId: null,
    awaySportEventParticipantId: null,
    isNeutralSite: true,
    scheduledDate: null,
    status: 'SCHEDULED',
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    advancesToMatchId: null,
    advancesToSide: null,
    ...overrides,
  };
}

function seed(matches: SportEventMatchDto[]) {
  getEventMock.mockResolvedValue({ data: { event: tournament } });
  listEventParticipantsMock.mockResolvedValue({ data: { participants: [duke, vermont, houston, texas] } });
  getEventBracketMock.mockResolvedValue({ data: { matches } });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports/basketball/events/evt-1/results']}>
        <Routes>
          <Route element={<RootAdminSportEventResultsPage />} path="/manage/sports/:sport/events/:eventId/results" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminSportEventResultsPage for a basketball tournament', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('says the bracket is not loaded yet when the tournament has no matches', async () => {
    seed([]);
    renderPage();

    expect(await screen.findByTestId('root-admin-bracket-empty')).toHaveTextContent(
      'No bracket yet. Its matches are loaded before the tournament is released.',
    );
  });

  it('lists each round under its name, with seeded pairings and the earlier match that fills an open side', async () => {
    seed([
      match({ id: 'm-1', matchNumber: 1, roundNumber: 1, homeSportEventParticipantId: 'sep-1', awaySportEventParticipantId: 'sep-2', advancesToMatchId: 'm-3', advancesToSide: 'HOME', status: 'COMPLETED', winnerSide: 'HOME', homeScore: 80, awayScore: 61 }),
      match({ id: 'm-2', matchNumber: 2, roundNumber: 1, homeSportEventParticipantId: 'sep-3', awaySportEventParticipantId: 'sep-4', isNeutralSite: false, advancesToMatchId: 'm-3', advancesToSide: 'AWAY' }),
      match({ id: 'm-3', matchNumber: 3, roundNumber: 2 }),
    ]);
    renderPage();

    const firstRound = await screen.findByTestId('root-admin-bracket-round-1');
    expect(within(firstRound).getByRole('heading')).toHaveTextContent('Final Four');
    expect(screen.getByTestId('root-admin-bracket-pairing-1')).toHaveTextContent('(1) Duke vs (16) Vermont');
    expect(screen.getByTestId('root-admin-bracket-pairing-2')).toHaveTextContent('(15) Texas @ (2) Houston');
    expect(within(screen.getByTestId('root-admin-bracket-match-1')).getByText('Final')).toBeInTheDocument();

    const final = screen.getByTestId('root-admin-bracket-round-2');
    expect(within(final).getByRole('heading')).toHaveTextContent('National Championship');
    expect(screen.getByTestId('root-admin-bracket-pairing-3')).toHaveTextContent('Winner of match 1 vs Winner of match 2');
    expect(within(screen.getByTestId('root-admin-bracket-match-3')).getByText('To be announced')).toBeInTheDocument();
  });
});
