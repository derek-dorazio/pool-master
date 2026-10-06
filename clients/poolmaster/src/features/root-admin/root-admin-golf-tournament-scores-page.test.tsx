import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentScoresPage } from './root-admin-golf-tournament-scores-page';
import {
  fieldEntryFixture,
  participantFixture,
  sportEventFixture,
  sportEventRoundFixture,
} from './golf-test-fixtures';

// plans/124 §6.3 — /manage/golf/tournaments/:eventId/scores Round scores (pool-master-r11).

const {
  getEventMock,
  listEventRoundsMock,
  listEventParticipantsMock,
  previewEventGolfRoundScoresMock,
  applyEventGolfRoundScoresMock,
  mockLogger,
} = vi.hoisted(() => {
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
    listEventRoundsMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    previewEventGolfRoundScoresMock: vi.fn(),
    applyEventGolfRoundScoresMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  listEventRounds: listEventRoundsMock,
  listEventParticipants: listEventParticipantsMock,
  previewEventGolfRoundScores: previewEventGolfRoundScoresMock,
  applyEventGolfRoundScores: applyEventGolfRoundScoresMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function tournament(overrides: Parameters<typeof sportEventFixture>[0] = {}) {
  return sportEventFixture({
    id: 'evt-1',
    name: 'The Open',
    venue: 'Royal Liverpool',
    location: 'Hoylake',
    startDate: '2026-07-16T08:00:00.000Z',
    endDate: '2026-07-19T20:00:00.000Z',
    status: 'IN_PROGRESS',
    rounds: 4,
    releaseAt: '2026-07-01T00:00:00.000Z',
    fieldLocksAt: '2026-07-15T00:00:00.000Z',
    fieldLocked: true,
    eventSeriesId: 'event-series-1',
    eventYear: 2026,
    sportLeagueId: 'league-1',
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    loadedParticipantCount: 2,
    tierCount: 6,
    contestCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    allowedTransitions: [],
    ...overrides,
  });
}

// #236: a golfer's per-round golf results ride on the field row; the page picks the
// chosen round's out of it.
function roundResult(roundNumber: number, strokes: number) {
  return {
    id: `result-${roundNumber}`,
    sportEventRoundId: `round-${roundNumber}`,
    roundNumber,
    status: 'COMPLETED',
    completedAt: '2026-07-16T18:00:00.000Z',
    golf: { strokes, scoreToPar: strokes - 71, thru: 18 },
  };
}

function seed(overrides: { tournament?: Parameters<typeof tournament>[0] } = {}) {
  getEventMock.mockResolvedValue({
    data: { event: tournament(overrides.tournament) },
  });
  listEventRoundsMock.mockResolvedValue({
    data: {
      rounds: [1, 2, 3, 4].map((roundNumber) =>
        sportEventRoundFixture({
          sportEventId: 'evt-1',
          roundNumber,
          scheduledDate: `2026-07-${15 + roundNumber}T08:00:00.000Z`,
        }),
      ),
    },
  });
  listEventParticipantsMock.mockResolvedValue({
    data: {
      participants: [
        fieldEntryFixture({
          id: 'sep-1',
          participantId: 'p-1',
          participant: participantFixture({ id: 'p-1', name: 'Rory McIlroy', externalId: 'rory-1' }),
          ranking: 2,
          rounds: [roundResult(1, 70), roundResult(2, 70), roundResult(3, 72)],
        }),
      ],
    },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/golf/tournaments/evt-1/scores']}>
        <Routes>
          <Route
            element={<RootAdminGolfTournamentScoresPage />}
            path="/manage/golf/tournaments/:eventId/scores"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-r11 RootAdminGolfTournamentScoresPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-r11 shows a round selector labelled by scheduled date, no sync alert for a manual tournament', async () => {
    seed();
    renderPage();

    expect(await screen.findByRole('radio', { name: /Round 1/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Round 4/ })).toBeInTheDocument();
    expect(
      screen.queryByTestId('root-admin-golf-scores-sync-alert'),
    ).not.toBeInTheDocument();
    // bulk load + corrections both render for round 1.
    expect(screen.getByTestId('root-admin-golf-scores-upload-textarea')).toBeInTheDocument();
    expect(screen.getByText('Rory McIlroy')).toBeInTheDocument();
  });

  it('pool-master-r11 shows the sync-tick alert for a SCORES_ONLY tournament but keeps the tools usable', async () => {
    seed({ tournament: { syncScope: 'SCORES_ONLY' } });
    renderPage();

    expect(await screen.findByTestId('root-admin-golf-scores-sync-alert')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-scores-upload-textarea')).toBeInTheDocument();
  });

  it('pool-master-r11 shows the selected round\'s scores, read from the field', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-golf-scores-strokes-sep-1')).toHaveValue('70');
    await userEvent.click(screen.getByRole('radio', { name: /Round 3/ }));

    await waitFor(() =>
      expect(screen.getByTestId('root-admin-golf-scores-strokes-sep-1')).toHaveValue('72'),
    );
    // No per-round read: one field read serves every round.
    expect(listEventParticipantsMock).toHaveBeenCalledTimes(1);
  });

  it('pool-master-r11 previews then applies a bulk score upload for the selected round', async () => {
    seed();
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [
          {
            row: { playerName: 'Rory McIlroy', strokes: 68, scoreToPar: -3, status: 'COMPLETED' },
            resolution: 'MATCHED',
            sportEventParticipantId: 'sep-1',
            participantName: 'Rory McIlroy',
            change: 'UPDATE',
            before: { strokes: 70, scoreToPar: -1, thru: 18, status: 'COMPLETED' },
            after: { strokes: 68, scoreToPar: -3, thru: 18, status: 'COMPLETED' },
          },
        ],
        rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0 },
      },
    });
    applyEventGolfRoundScoresMock.mockResolvedValue({ data: {} });
    renderPage();

    const textarea = await screen.findByTestId('root-admin-golf-scores-upload-textarea');
    await userEvent.type(
      textarea,
      'externalId,playerName,strokes,scoreToPar,thru,status\n,Rory McIlroy,68,-3,18,COMPLETED',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-scores-upload-preview'));

    await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    expect(screen.getByText('MATCHED')).toBeInTheDocument();
    expect(screen.getByText('UPDATE')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId('root-admin-golf-scores-upload-apply')).toBeEnabled(),
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-scores-upload-apply'));

    await waitFor(() =>
      expect(applyEventGolfRoundScoresMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1', roundNumber: '1' },
          body: {
            rows: [
              { playerName: 'Rory McIlroy', strokes: 68, scoreToPar: -3, thru: 18, status: 'COMPLETED' },
            ],
          },
        }),
      ),
    );
  });

  it('pool-master-r11 blocks Apply while a previewed row is unresolved', async () => {
    seed();
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [
          {
            row: { playerName: 'Ghost', strokes: 70, scoreToPar: -1, status: 'COMPLETED' },
            resolution: 'UNRESOLVED',
            sportEventParticipantId: '',
            participantName: '',
            change: 'CREATE',
            before: { strokes: 0, scoreToPar: 0, thru: 0, status: '' },
            after: { strokes: 70, scoreToPar: -1, thru: 0, status: 'COMPLETED' },
          },
        ],
        rollup: { total: 1, matched: 0, unresolved: 1, ambiguous: 0 },
      },
    });
    renderPage();

    const textarea = await screen.findByTestId('root-admin-golf-scores-upload-textarea');
    await userEvent.type(
      textarea,
      'playerName,strokes,scoreToPar,status\nGhost,70,-1,COMPLETED',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-scores-upload-preview'));

    await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    expect(screen.getByTestId('root-admin-golf-scores-upload-unresolved')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-scores-upload-apply')).toBeDisabled();
  });

  it('labels a previewed row with no strokes "Not stored (no strokes)"', async () => {
    seed();
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [
          {
            row: { playerName: 'Rory McIlroy', strokes: null, scoreToPar: -1, status: 'IN_PROGRESS' },
            resolution: 'MATCHED',
            sportEventParticipantId: 'sep-1',
            participantName: 'Rory McIlroy',
            change: 'SKIPPED',
            before: null,
            after: { strokes: null, scoreToPar: -1, thru: null, status: 'IN_PROGRESS' },
          },
        ],
        rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0 },
      },
    });
    renderPage();

    const textarea = await screen.findByTestId('root-admin-golf-scores-upload-textarea');
    await userEvent.type(textarea, 'playerName,strokes,scoreToPar,status\nRory McIlroy,70,-1,IN_PROGRESS');
    await userEvent.click(screen.getByTestId('root-admin-golf-scores-upload-preview'));

    const table = await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    expect(within(table).getByText('Not stored (no strokes)')).toBeInTheDocument();
  });

  it('pool-master-r11 clears a pending preview and any typed correction when the round changes (key remount)', async () => {
    seed();
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [
          {
            row: { playerName: 'Rory McIlroy', strokes: 68, scoreToPar: -3, status: 'COMPLETED' },
            resolution: 'MATCHED',
            sportEventParticipantId: 'sep-1',
            participantName: 'Rory McIlroy',
            change: 'UPDATE',
            before: { strokes: 70, scoreToPar: -1, thru: 18, status: 'COMPLETED' },
            after: { strokes: 68, scoreToPar: -3, thru: 18, status: 'COMPLETED' },
          },
        ],
        rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0 },
      },
    });
    renderPage();

    // Preview for round 1, and start a correction edit.
    const textarea = await screen.findByTestId('root-admin-golf-scores-upload-textarea');
    await userEvent.type(
      textarea,
      'playerName,strokes,scoreToPar,thru,status\nRory McIlroy,68,-3,18,COMPLETED',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-scores-upload-preview'));
    await screen.findByTestId('root-admin-golf-scores-upload-preview-table');

    const strokes = screen.getByTestId('root-admin-golf-scores-strokes-sep-1');
    await userEvent.clear(strokes);
    await userEvent.type(strokes, '65');
    expect(screen.getByTestId('root-admin-golf-scores-save-sep-1')).toBeEnabled();

    // Switch rounds -> both cards remount: preview gone, textarea empty, correction reset.
    await userEvent.click(screen.getByRole('radio', { name: /Round 2/ }));

    await waitFor(() =>
      expect(
        screen.queryByTestId('root-admin-golf-scores-upload-preview-table'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('root-admin-golf-scores-upload-textarea')).toHaveValue('');
    expect(screen.getByTestId('root-admin-golf-scores-strokes-sep-1')).toHaveValue('70');
    expect(screen.getByTestId('root-admin-golf-scores-save-sep-1')).toBeDisabled();
  });

  it('pool-master-r11 surfaces a round-schedule load error without blocking the tools', async () => {
    seed();
    listEventRoundsMock.mockResolvedValue({
      error: { code: 'INTERNAL', message: 'Round schedule offline' },
      response: { status: 500 },
    });
    renderPage();

    expect(await screen.findByText('Round schedule offline')).toBeInTheDocument();
    // Rounds fall back to numbered options from tournament.rounds.
    expect(screen.getByRole('radio', { name: 'Round 1' })).toBeInTheDocument();
  });

  it('pool-master-r11 renders read-only for a FULL provider-owned tournament', async () => {
    seed({ tournament: { syncScope: 'FULL' } });
    renderPage();

    expect(await screen.findByText(/fully provider-owned/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId('root-admin-golf-scores-upload-textarea'),
    ).not.toBeInTheDocument();
    // corrections grid still visible but non-interactive.
    expect(screen.getByText('Rory McIlroy')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-scores-strokes-sep-1')).toBeDisabled();
    expect(screen.getByTestId('root-admin-golf-scores-status-sep-1')).toBeDisabled();
    expect(
      screen.queryByTestId('root-admin-golf-scores-save-sep-1'),
    ).not.toBeInTheDocument();
  });

  it('pool-master-r11 surfaces the tournament load error', async () => {
    getEventMock.mockResolvedValue({
      error: { code: 'NOT_FOUND', message: 'No such tournament' },
      response: { status: 404 },
    });
    listEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();

    expect(await screen.findByText('No such tournament')).toBeInTheDocument();
  });
});
