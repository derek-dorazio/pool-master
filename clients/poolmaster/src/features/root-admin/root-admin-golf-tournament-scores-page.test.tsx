import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentScoresPage } from './root-admin-golf-tournament-scores-page';

// plans/124 §6.3 — /manage/golf/tournaments/:eventId/scores Round scores (pool-master-r11).

const {
  adminGetGolfTournamentMock,
  adminGetGolfTournamentRoundsMock,
  adminGetGolfTournamentFieldMock,
  adminGetGolfRoundScoresMock,
  adminPreviewGolfRoundScoresMock,
  adminApplyGolfRoundScoresMock,
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
    adminGetGolfTournamentMock: vi.fn(),
    adminGetGolfTournamentRoundsMock: vi.fn(),
    adminGetGolfTournamentFieldMock: vi.fn(),
    adminGetGolfRoundScoresMock: vi.fn(),
    adminPreviewGolfRoundScoresMock: vi.fn(),
    adminApplyGolfRoundScoresMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  adminGetGolfTournament: adminGetGolfTournamentMock,
  adminGetGolfTournamentRounds: adminGetGolfTournamentRoundsMock,
  adminGetGolfTournamentField: adminGetGolfTournamentFieldMock,
  adminGetGolfRoundScores: adminGetGolfRoundScoresMock,
  adminPreviewGolfRoundScores: adminPreviewGolfRoundScoresMock,
  adminApplyGolfRoundScores: adminApplyGolfRoundScoresMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function tournament(overrides: Record<string, unknown> = {}) {
  return {
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
    seasonId: 'season-2026',
    leagueEventId: '',
    source: 'MANUAL',
    syncScope: 'NONE',
    scoreSource: { providerId: '', externalId: '' },
    autoLifecycleEnabled: true,
    par: 71,
    fieldCount: 2,
    tierCount: 6,
    contestCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    workflow: { currentStatus: 'IN_PROGRESS', allowedTransitions: [] },
    ...overrides,
  };
}

function scoreRow(sep: string, name: string, strokes = 70) {
  return {
    sportEventParticipantId: sep,
    participantId: `p-${sep}`,
    participantName: name,
    strokes,
    scoreToPar: strokes - 71,
    thru: 18,
    status: 'COMPLETED',
    completedAt: '2026-07-16T18:00:00.000Z',
    standing: {
      eventScoreToPar: strokes - 71,
      eventStrokes: strokes,
      currentRound: 1,
      currentRoundThru: 18,
      status: 'COMPLETED',
    },
  };
}

function seed(overrides: { tournament?: Record<string, unknown> } = {}) {
  adminGetGolfTournamentMock.mockResolvedValue({
    data: { tournament: tournament(overrides.tournament) },
  });
  adminGetGolfTournamentRoundsMock.mockResolvedValue({
    data: {
      rounds: [
        { roundNumber: 1, scheduledDate: '2026-07-16T08:00:00.000Z', scheduledEndAt: '' },
        { roundNumber: 2, scheduledDate: '2026-07-17T08:00:00.000Z', scheduledEndAt: '' },
        { roundNumber: 3, scheduledDate: '2026-07-18T08:00:00.000Z', scheduledEndAt: '' },
        { roundNumber: 4, scheduledDate: '2026-07-19T08:00:00.000Z', scheduledEndAt: '' },
      ],
    },
  });
  adminGetGolfTournamentFieldMock.mockResolvedValue({
    data: {
      entries: [
        {
          sportEventParticipantId: 'sep-1',
          participantId: 'p-1',
          participantName: 'Rory McIlroy',
          shortName: 'R. McIlroy',
          nationality: 'NIR',
          isActive: true,
          inactiveReason: null,
          worldRanking: 2,
          oddsToWin: 8,
          seedNumber: 2,
          price: 9000,
          isLeagueRosterMember: true,
        },
      ],
    },
  });
  adminGetGolfRoundScoresMock.mockResolvedValue({
    data: { rows: [scoreRow('sep-1', 'Rory McIlroy')] },
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

  it('pool-master-r11 refetches scores for the selected round', async () => {
    seed();
    renderPage();

    await screen.findByRole('radio', { name: /Round 1/ });
    await userEvent.click(screen.getByRole('radio', { name: /Round 3/ }));

    await waitFor(() =>
      expect(adminGetGolfRoundScoresMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { eventId: 'evt-1', round: '3' } }),
      ),
    );
  });

  it('pool-master-r11 previews then applies a bulk score upload for the selected round', async () => {
    seed();
    adminPreviewGolfRoundScoresMock.mockResolvedValue({
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
    adminApplyGolfRoundScoresMock.mockResolvedValue({ data: {} });
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
      expect(adminApplyGolfRoundScoresMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1', round: '1' },
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
    adminPreviewGolfRoundScoresMock.mockResolvedValue({
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

  it('pool-master-r11 clears a pending preview and any typed correction when the round changes (key remount)', async () => {
    seed();
    adminPreviewGolfRoundScoresMock.mockResolvedValue({
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
    adminGetGolfTournamentRoundsMock.mockResolvedValue({
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
    adminGetGolfTournamentMock.mockResolvedValue({
      error: { code: 'NOT_FOUND', message: 'No such tournament' },
      response: { status: 404 },
    });
    adminGetGolfTournamentRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    adminGetGolfTournamentFieldMock.mockResolvedValue({ data: { entries: [] } });
    adminGetGolfRoundScoresMock.mockResolvedValue({ data: { rows: [] } });
    renderPage();

    expect(await screen.findByText('No such tournament')).toBeInTheDocument();
  });
});
