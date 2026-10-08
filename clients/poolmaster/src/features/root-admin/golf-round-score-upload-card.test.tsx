import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { GolfRoundScoreUploadCard } from './golf-round-score-upload-card';

// The bulk round-score upload: what its preview says about each row, and how it reports a
// refused preview or apply.

const { previewEventGolfRoundScoresMock, applyEventGolfRoundScoresMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return { previewEventGolfRoundScoresMock: vi.fn(), applyEventGolfRoundScoresMock: vi.fn(), mockLogger: logger };
});

bindApiMocks({
  previewEventGolfRoundScores: previewEventGolfRoundScoresMock,
  applyEventGolfRoundScores: applyEventGolfRoundScoresMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GolfRoundScoreUploadCard eventId="evt-1" fieldPlayers={[{ externalId: 'rory-1', playerName: 'Rory McIlroy' }]} round={1} />
    </QueryClientProvider>,
  );
}

async function previewUpload(csv = 'playerName,strokes,scoreToPar,status\nRory McIlroy,70,-2,COMPLETED') {
  await userEvent.type(screen.getByTestId('root-admin-golf-scores-upload-textarea'), csv);
  await userEvent.click(screen.getByTestId('root-admin-golf-scores-upload-preview'));
}

function previewResponse(row: Record<string, unknown>) {
  return {
    data: {
      rows: [{
        row: { playerName: 'Rory McIlroy', strokes: 70, scoreToPar: -2, status: 'COMPLETED' },
        resolution: 'MATCHED',
        sportEventParticipantId: 'sep-1',
        participantName: 'Rory McIlroy',
        change: 'UPDATE',
        before: { strokes: 70, scoreToPar: -1, thru: 18, status: 'COMPLETED' },
        after: { strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED' },
        ...row,
      }],
      rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0 },
    },
  };
}

describe('GolfRoundScoreUploadCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('shows the to-par change in the preview, so a to-par-only correction does not read as no change', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue(previewResponse({}));
    renderCard();

    await previewUpload();

    const table = await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    const [, dataRow] = within(table).getAllByRole('row');
    expect(dataRow).toHaveTextContent('70 (-1)·Completed → 70 (-2)·Completed');
  });

  it('shows a dash for the strokes of a row with none, never the word "null"', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue(previewResponse({
      row: { playerName: 'Rory McIlroy', strokes: null, scoreToPar: -1, status: 'IN_PROGRESS' },
      change: 'SKIPPED',
      before: null,
      after: { strokes: null, scoreToPar: -1, thru: null, status: 'IN_PROGRESS' },
    }));
    renderCard();

    await previewUpload();

    const table = await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    expect(table).not.toHaveTextContent('null');
    const [, dataRow] = within(table).getAllByRole('row');
    expect(dataRow).toHaveTextContent('— → — (-1)·In progress');
  });

  it('names an unnamed row by its external id, and says how many rows could not be matched', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [
          { row: { externalId: 'ghost-1', strokes: 70, scoreToPar: -2, status: 'COMPLETED' }, resolution: 'UNRESOLVED', sportEventParticipantId: null, participantName: null, change: 'CREATE', before: null, after: { strokes: 70, scoreToPar: -2, thru: null, status: 'COMPLETED' } },
          { row: { externalId: 'ghost-2', strokes: 71, scoreToPar: -1, status: 'COMPLETED' }, resolution: 'AMBIGUOUS', sportEventParticipantId: null, participantName: null, change: 'CREATE', before: null, after: { strokes: 71, scoreToPar: -1, thru: null, status: 'COMPLETED' } },
        ],
        rollup: { total: 2, matched: 0, unresolved: 1, ambiguous: 1 },
      },
    });
    renderCard();

    await previewUpload('externalId,strokes,scoreToPar,status\nghost-1,70,-2,COMPLETED\nghost-2,71,-1,COMPLETED');

    const table = await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    expect(within(table).getByText('ghost-1')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-scores-upload-unresolved'))
      .toHaveTextContent('2 rows could not be matched to a golfer in the field. Fix or remove them before applying.');
    expect(screen.getByTestId('root-admin-golf-scores-upload-apply')).toBeDisabled();
  });

  it('shows the server\'s reason when a preview is refused', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue({
      error: { code: 'ROUND_BEYOND_SCHEDULE', message: 'Round 1 is beyond the event\'s 0 scheduled rounds.' },
    });
    renderCard();

    await previewUpload();

    expect(await screen.findByTestId('root-admin-golf-scores-upload-preview-error'))
      .toHaveTextContent('Round 1 is beyond the event\'s 0 scheduled rounds.');
  });

  it('shows the server\'s reason when an apply is refused', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue(previewResponse({}));
    applyEventGolfRoundScoresMock.mockResolvedValue({
      error: { code: 'ROUND_SCORE_ROWS_UNRESOLVED', message: '1 round score row(s) could not be resolved to a golfer.' },
    });
    renderCard();

    await previewUpload();
    await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    await userEvent.click(screen.getByTestId('root-admin-golf-scores-upload-apply'));

    expect(await screen.findByTestId('root-admin-golf-scores-upload-apply-error'))
      .toHaveTextContent('1 round score row(s) could not be resolved to a golfer.');
  });
});
