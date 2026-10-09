import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { GolfRoundScoreCorrectionsCard } from './golf-round-score-corrections-card';
import type { GolfRoundScoreRow } from './golf-admin-utils';

// plans/124 §6.3 Round scores section 2 — inline corrections (pool-master-r11).

const { updateEventParticipantGolfRoundScoreMock, mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return { updateEventParticipantGolfRoundScoreMock: vi.fn(), mockLogger: logger };
});

bindApiMocks({ updateEventParticipantGolfRoundScore: updateEventParticipantGolfRoundScoreMock });

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

// #236: one round's score row, as golfRoundScoreRows reads it off the field.
function scoreRow(overrides: Partial<GolfRoundScoreRow> = {}): GolfRoundScoreRow {
  return {
    sportEventParticipantId: 'sep-1',
    participantName: 'Rory McIlroy',
    strokes: 70,
    scoreToPar: -2,
    thru: 18,
    status: 'IN_PROGRESS',
    completedAt: null,
    ...overrides,
  };
}

function renderCard(props: Partial<Parameters<typeof GolfRoundScoreCorrectionsCard>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GolfRoundScoreCorrectionsCard
        eventId="evt-1"
        round={2}
        rows={[scoreRow()]}
        rowsError={null}
        rowsLoading={false}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('pool-master-r11 GolfRoundScoreCorrectionsCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-r11 saves a single row correction with only the changed fields', async () => {
    updateEventParticipantGolfRoundScoreMock.mockResolvedValue({ data: {} });
    renderCard();

    const strokes = screen.getByTestId('root-admin-golf-scores-strokes-sep-1');
    await userEvent.clear(strokes);
    await userEvent.type(strokes, '68');
    await userEvent.selectOptions(
      screen.getByTestId('root-admin-golf-scores-status-sep-1'),
      'COMPLETED',
    );
    await userEvent.click(screen.getByTestId('root-admin-golf-scores-save-sep-1'));

    await waitFor(() =>
      expect(updateEventParticipantGolfRoundScoreMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1', roundNumber: '2', sportEventParticipantId: 'sep-1' },
          body: { strokes: 68, status: 'COMPLETED' },
        }),
      ),
    );
  });

  it('saves strokes, to par, thru, status and completed at edited on one row in one request, without filling one from another', async () => {
    updateEventParticipantGolfRoundScoreMock.mockResolvedValue({ data: {} });
    renderCard();

    const strokes = screen.getByRole('textbox', { name: 'Strokes for Rory McIlroy' });
    await userEvent.clear(strokes);
    await userEvent.type(strokes, '73');
    // Editing strokes leaves to par as stored; the admin sets it.
    expect(screen.getByRole('textbox', { name: 'Score to par for Rory McIlroy' })).toHaveValue('-2');
    const toPar = screen.getByRole('textbox', { name: 'Score to par for Rory McIlroy' });
    await userEvent.clear(toPar);
    await userEvent.type(toPar, '+1');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Status for Rory McIlroy' }),
      'COMPLETED',
    );
    // Completing the round leaves completed at blank; the admin sets it.
    const completedAt = screen.getByLabelText('Completed at for Rory McIlroy');
    expect(completedAt).toHaveValue('');
    await userEvent.type(completedAt, '2026-04-10T15:30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateEventParticipantGolfRoundScoreMock).toHaveBeenCalledTimes(1));
    expect(updateEventParticipantGolfRoundScoreMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { eventId: 'evt-1', roundNumber: '2', sportEventParticipantId: 'sep-1' },
        body: {
          strokes: 73,
          scoreToPar: 1,
          status: 'COMPLETED',
          completedAt: new Date('2026-04-10T15:30').toISOString(),
        },
      }),
    );
  });

  it('keeps Save disabled while the to par value is not a whole number', async () => {
    renderCard();
    const toPar = screen.getByRole('textbox', { name: 'Score to par for Rory McIlroy' });
    await userEvent.clear(toPar);
    await userEvent.type(toPar, '-1.5');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps Save disabled while completed at is half typed, so a stored time is never cleared by accident', () => {
    renderCard({ rows: [scoreRow({ completedAt: '2026-04-10T22:15:00.000Z' })] });
    const completedAt = screen.getByLabelText('Completed at for Rory McIlroy');
    // A datetime-local input with only the date typed reports value '' and validity.badInput.
    Object.defineProperty(completedAt, 'validity', { value: { badInput: true } });
    fireEvent.change(completedAt, { target: { value: '' } });

    expect(completedAt).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('pool-master-r11 keeps the per-row Save disabled until the row is dirty and valid', async () => {
    renderCard();
    expect(screen.getByTestId('root-admin-golf-scores-save-sep-1')).toBeDisabled();

    const strokes = screen.getByTestId('root-admin-golf-scores-strokes-sep-1');
    await userEvent.clear(strokes);
    await userEvent.type(strokes, 'abc');
    expect(screen.getByTestId('root-admin-golf-scores-save-sep-1')).toBeDisabled();

    await userEvent.clear(strokes);
    await userEvent.type(strokes, '69');
    expect(screen.getByTestId('root-admin-golf-scores-save-sep-1')).toBeEnabled();
  });

  it('pool-master-r11 surfaces the row-load error', () => {
    renderCard({ rows: [], rowsError: 'Round scores offline' });
    expect(screen.getByText('Round scores offline')).toBeInTheDocument();
  });

  it('shows a blank holes-completed cell, not "null", for a round stored without thru, and leaves the row valid', () => {
    renderCard({ rows: [scoreRow({ thru: null })] });

    const thru = screen.getByTestId('root-admin-golf-scores-thru-sep-1');
    expect(thru).toHaveValue('');
    expect(thru).not.toHaveAttribute('aria-invalid');
  });

  it('shows the server\'s reason when a correction is refused, and keeps the typed value', async () => {
    updateEventParticipantGolfRoundScoreMock.mockResolvedValue({
      error: { error: { code: 'ROUND_BEYOND_SCHEDULE', message: 'Round 2 is beyond the event\'s 1 scheduled rounds.' } },
    });
    renderCard();

    const strokes = screen.getByTestId('root-admin-golf-scores-strokes-sep-1');
    await userEvent.clear(strokes);
    await userEvent.type(strokes, '68');
    await userEvent.click(screen.getByTestId('root-admin-golf-scores-save-sep-1'));

    expect(await screen.findByTestId('root-admin-golf-scores-correction-save-error'))
      .toHaveTextContent('Round 2 is beyond the event\'s 1 scheduled rounds.');
    expect(strokes).toHaveValue('68');
  });

  it('says scores are loading while the round loads, and points to the bulk load when the round has none', () => {
    const { rerender } = renderCard({ rows: [], rowsLoading: true });
    expect(screen.getByText('Loading scores…')).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <GolfRoundScoreCorrectionsCard eventId="evt-1" round={2} rows={[]} rowsError={null} rowsLoading={false} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('No scores recorded for this round yet. Use the bulk load above.')).toBeInTheDocument();
  });
});
