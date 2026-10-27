import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SportEventParticipantDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportEventResultsPage } from './root-admin-sport-event-results-page';
import { fieldEntryFixture, participantFixture, sportEventFixture } from './sport-test-fixtures';

// #935: a stat pool event's results page is its box scores, one game at a time, and an admin
// corrects one player's line with a save that sends their whole line for the game.

const { getEventMock, listEventParticipantsMock, applyEventGameStatLinesMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return {
    getEventMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    applyEventGameStatLinesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  listEventParticipants: listEventParticipantsMock,
  applyEventGameStatLines: applyEventGameStatLinesMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const worldSeries = sportEventFixture({
  id: 'evt-1',
  sport: 'BASEBALL',
  name: '2025 World Series',
  status: 'IN_PROGRESS',
  rounds: 7,
  roundsPar: null,
  participantType: 'INDIVIDUAL',
  scoringFamily: 'COMPOSITE',
  allowedTransitions: [],
});

function gameRound(roundNumber: number, statLines: SportEventParticipantDto['rounds'][number]['statLines']): SportEventParticipantDto['rounds'][number] {
  return {
    id: `spr-${roundNumber}`,
    sportEventRoundId: `round-${roundNumber}`,
    roundNumber,
    status: 'COMPLETED',
    completedAt: '2025-10-25T03:00:00.000Z',
    golf: null,
    statLines,
  };
}

const ohtani = fieldEntryFixture({
  id: 'sep-1',
  participantId: 'p-1',
  participant: participantFixture({ id: 'p-1', name: 'Shohei Ohtani', externalId: 'mlb-shohei-ohtani', teamAffiliation: 'Los Angeles Dodgers' }),
  rounds: [gameRound(1, [{ stat: 'TOTAL_BASES', value: 4 }, { stat: 'RUNS', value: 1 }, { stat: 'RUNS_BATTED_IN', value: 2 }])],
});
const guerrero = fieldEntryFixture({
  id: 'sep-2',
  participantId: 'p-2',
  participant: participantFixture({ id: 'p-2', name: 'Vladimir Guerrero Jr.', externalId: 'mlb-vladimir-guerrero-jr' }),
});

function renderPage() {
  getEventMock.mockResolvedValue({ data: { event: worldSeries } });
  listEventParticipantsMock.mockResolvedValue({ data: { participants: [ohtani, guerrero] } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports/baseball/events/evt-1/results']}>
        <Routes>
          <Route element={<RootAdminSportEventResultsPage />} path="/manage/sports/:sport/events/:eventId/results" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminSportEventResultsPage for a stat pool event', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('shows game 1\'s box score with a column per Box Score stat and each player\'s composite, a missing line blank and 0', async () => {
    renderPage();

    const table = await screen.findByTestId('root-admin-stat-lines-table');
    const [headings] = within(table).getAllByRole('row');
    expect(within(headings).getAllByRole('columnheader').map((cell) => cell.textContent.replace('↕', ''))).toEqual(['Player', 'TB', 'R', 'RBI', 'BB', 'SB', 'Box Score', '']);
    expect(await screen.findByTestId('root-admin-stat-lines-TOTAL_BASES-sep-1')).toHaveValue('4');
    expect(screen.getByTestId('root-admin-stat-lines-WALKS-sep-1')).toHaveValue('');
    expect(screen.getByTestId('root-admin-stat-lines-total-sep-1')).toHaveTextContent('7');
    expect(screen.getByTestId('root-admin-stat-lines-total-sep-2')).toHaveTextContent('0');
    expect(screen.getByRole('radio', { name: 'Game 7' })).toBeInTheDocument();
    expect(screen.queryByText('World Series')).not.toBeInTheDocument();
  });

  it('saves a corrected line as the player\'s whole line for the game, blank stats left out', async () => {
    applyEventGameStatLinesMock.mockResolvedValue({ data: { participants: [ohtani, guerrero] } });
    renderPage();

    const walks = await screen.findByTestId('root-admin-stat-lines-WALKS-sep-1');
    expect(screen.getByTestId('root-admin-stat-lines-save-sep-1')).toBeDisabled();
    await userEvent.type(walks, '2');
    expect(screen.getByTestId('root-admin-stat-lines-total-sep-1')).toHaveTextContent('9');
    await userEvent.click(screen.getByTestId('root-admin-stat-lines-save-sep-1'));

    await waitFor(() => expect(applyEventGameStatLinesMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1', roundNumber: '1' },
      body: {
        rows: [{
          participantId: 'p-1',
          stats: [
            { stat: 'TOTAL_BASES', value: 4 },
            { stat: 'RUNS', value: 1 },
            { stat: 'RUNS_BATTED_IN', value: 2 },
            { stat: 'WALKS', value: 2 },
          ],
        }],
      },
    })));
  });

  it('sends an empty line when every stat is cleared, and refuses to save a value that is not a whole number', async () => {
    applyEventGameStatLinesMock.mockResolvedValue({ data: { participants: [ohtani, guerrero] } });
    renderPage();

    await userEvent.clear(await screen.findByTestId('root-admin-stat-lines-TOTAL_BASES-sep-1'));
    await userEvent.clear(screen.getByTestId('root-admin-stat-lines-RUNS-sep-1'));
    await userEvent.type(screen.getByTestId('root-admin-stat-lines-RUNS_BATTED_IN-sep-1'), 'x');
    expect(screen.getByTestId('root-admin-stat-lines-RUNS_BATTED_IN-sep-1')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('root-admin-stat-lines-save-sep-1')).toBeDisabled();

    await userEvent.clear(screen.getByTestId('root-admin-stat-lines-RUNS_BATTED_IN-sep-1'));
    await userEvent.click(screen.getByTestId('root-admin-stat-lines-save-sep-1'));
    await waitFor(() => expect(applyEventGameStatLinesMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { rows: [{ participantId: 'p-1', stats: [] }] },
    })));
  });

  it('shows the next game\'s lines when another game is chosen', async () => {
    renderPage();

    await screen.findByTestId('root-admin-stat-lines-total-sep-1');
    await userEvent.click(screen.getByRole('radio', { name: 'Game 2' }));
    expect(screen.getByTestId('root-admin-stat-lines-TOTAL_BASES-sep-1')).toHaveValue('');
    expect(screen.getByTestId('root-admin-stat-lines-total-sep-1')).toHaveTextContent('0');
  });

  it('shows the API\'s refusal when a save is rejected', async () => {
    applyEventGameStatLinesMock.mockResolvedValue({
      error: { error: { code: 'STAT_LINE_ROWS_INVALID', message: 'Game 1\'s stat lines cannot be stored: participant p-1 is not in the field.' } },
    });
    renderPage();

    await userEvent.type(await screen.findByTestId('root-admin-stat-lines-WALKS-sep-1'), '1');
    await userEvent.click(screen.getByTestId('root-admin-stat-lines-save-sep-1'));
    expect(await screen.findByTestId('root-admin-stat-lines-save-error')).toHaveTextContent('participant p-1 is not in the field');
  });
});
