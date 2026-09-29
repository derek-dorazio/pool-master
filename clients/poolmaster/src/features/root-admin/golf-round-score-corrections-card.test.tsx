import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import {
  GolfRoundScoreCorrectionsCard,
  buildRoundScorePatch,
} from './golf-round-score-corrections-card';
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
        readOnly={false}
        round={2}
        rows={[scoreRow()]}
        rowsError={null}
        rowsLoading={false}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('pool-master-r11 buildRoundScorePatch', () => {
  const row = scoreRow();

  it('pool-master-r11 returns null when nothing changed', () => {
    expect(buildRoundScorePatch(row, undefined)).toBeNull();
    expect(buildRoundScorePatch(row, { strokes: '70' })).toBeNull();
  });

  it('pool-master-r11 emits only the changed fields', () => {
    expect(buildRoundScorePatch(row, { strokes: '69', status: 'COMPLETED' })).toEqual({
      strokes: 69,
      status: 'COMPLETED',
    });
  });

  it('pool-master-r11 ignores an invalid numeric draft value', () => {
    expect(buildRoundScorePatch(row, { strokes: 'x' })).toBeNull();
    expect(buildRoundScorePatch(row, { thru: '-1' })).toBeNull();
  });
});

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

  it('pool-master-r11 hides the Save column when read-only', () => {
    renderCard({ readOnly: true });
    expect(screen.queryByTestId('root-admin-golf-scores-save-sep-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-scores-strokes-sep-1')).toBeInTheDocument();
  });

  it('pool-master-r11 surfaces the row-load error', () => {
    renderCard({ rows: [], rowsError: 'Round scores offline' });
    expect(screen.getByText('Round scores offline')).toBeInTheDocument();
  });
});
