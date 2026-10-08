import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { GolfRoundScoreUploadCard } from './golf-round-score-upload-card';

// plans/124 §6.3 Round scores — the bulk paste / preview / apply card for one round.

const { previewEventGolfRoundScoresMock, applyEventGolfRoundScoresMock, mockLogger } = vi.hoisted(() => {
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
    previewEventGolfRoundScoresMock: vi.fn(),
    applyEventGolfRoundScoresMock: vi.fn(),
    mockLogger: logger,
  };
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

const PASTE = 'externalId,playerName,strokes,scoreToPar,thru,status\next-1,Rory McIlroy,68,-3,18,COMPLETED';

function renderCard(fieldPlayers: Array<{ externalId?: string; playerName: string }> = []) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GolfRoundScoreUploadCard eventId="evt-1" fieldPlayers={fieldPlayers} round={2} />
    </QueryClientProvider>,
  );
}

function templateCsv() {
  const href = screen.getByTestId('root-admin-golf-scores-upload-template').getAttribute('href') ?? '';
  return decodeURIComponent(href.replace('data:text/csv;charset=utf-8,', ''));
}

function previewRow(overrides: Record<string, unknown>) {
  return {
    row: { strokes: 70, scoreToPar: -1, status: 'COMPLETED' },
    resolution: 'MATCHED',
    sportEventParticipantId: 'sep-1',
    participantName: 'Rory McIlroy',
    change: 'CREATE',
    before: null,
    after: null,
    ...overrides,
  };
}

function pasteAndPreview() {
  fireEvent.change(screen.getByTestId('root-admin-golf-scores-upload-textarea'), { target: { value: PASTE } });
  fireEvent.click(screen.getByTestId('root-admin-golf-scores-upload-preview'));
}

describe('GolfRoundScoreUploadCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('offers a template with only the sample row, named for the round, when the field is empty', () => {
    renderCard([]);

    expect(screen.getByTestId('root-admin-golf-scores-upload-template')).toHaveAttribute(
      'download',
      'golf-round-2-scores-template.csv',
    );
    expect(templateCsv()).toContain('ext-123,Rory McIlroy,70,-2,18,COMPLETED');
  });

  it('prefills the template with one row per field golfer, leaving the externalId blank when the golfer has none', () => {
    renderCard([{ externalId: 'ext-9', playerName: 'Jon Rahm' }, { playerName: 'Sponsor Exemption' }]);

    const csv = templateCsv();
    expect(csv).toContain('ext-9,Jon Rahm');
    expect(csv).toContain('\n,Sponsor Exemption');
    expect(csv).not.toContain('ext-123');
  });

  it('names preview rows by external id, then participant id, then "Unnamed row", and shows a dash for a missing result', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [
          previewRow({ row: { externalId: 'ext-1', strokes: 68 }, participantName: '', after: null }),
          previewRow({ row: { participantId: 'p-7', strokes: 70 } }),
          previewRow({ row: { strokes: 71 } }),
        ],
        rollup: { total: 3, matched: 3, unresolved: 0, ambiguous: 0 },
      },
    });
    renderCard();

    pasteAndPreview();

    const table = await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('ext-1');
    expect(rows[0]).toHaveTextContent('— → —');
    expect(rows[1]).toHaveTextContent('p-7');
    expect(rows[2]).toHaveTextContent('Unnamed row');
    expect(previewEventGolfRoundScoresMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { eventId: 'evt-1', roundNumber: '2' } }),
    );
  });

  it('counts several unmatched rows in the plural and keeps Apply disabled', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [
          previewRow({ row: { playerName: 'Ghost One' }, resolution: 'UNRESOLVED', participantName: '' }),
          previewRow({ row: { playerName: 'Ghost Two' }, resolution: 'AMBIGUOUS', participantName: '' }),
        ],
        rollup: { total: 2, matched: 0, unresolved: 1, ambiguous: 1 },
      },
    });
    renderCard();

    pasteAndPreview();

    expect(await screen.findByTestId('root-admin-golf-scores-upload-unresolved')).toHaveTextContent(
      '2 rows could not be matched to a golfer in the field. Fix or remove them before applying.',
    );
    expect(screen.getByTestId('root-admin-golf-scores-upload-apply')).toBeDisabled();
  });

  it('shows the server\'s reason when the preview is refused', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue({
      error: { error: { code: 'VALIDATION_ERROR', message: 'Round 2 is not part of this tournament.' } },
      response: { status: 422 },
    });
    renderCard();

    pasteAndPreview();

    expect(await screen.findByTestId('root-admin-golf-scores-upload-preview-error')).toHaveTextContent(
      'Round 2 is not part of this tournament.',
    );
  });

  it('shows the server\'s reason when applying previewed scores is refused', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [previewRow({ row: { externalId: 'ext-1', playerName: 'Rory McIlroy', strokes: 68 } })],
        rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0 },
      },
    });
    applyEventGolfRoundScoresMock.mockResolvedValue({
      error: { error: { code: 'SPORT_EVENT_COMPLETED', message: 'Scores of a completed tournament cannot change.' } },
      response: { status: 409 },
    });
    renderCard();

    pasteAndPreview();
    await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    await waitFor(() => expect(screen.getByTestId('root-admin-golf-scores-upload-apply')).toBeEnabled());
    fireEvent.click(screen.getByTestId('root-admin-golf-scores-upload-apply'));

    expect(await screen.findByTestId('root-admin-golf-scores-upload-apply-error')).toHaveTextContent(
      'Scores of a completed tournament cannot change.',
    );
  });

  it('shows the to-par change in the preview, so a to-par-only correction does not read as no change', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [
          previewRow({
            change: 'UPDATE',
            before: { strokes: 70, scoreToPar: -1, thru: 18, status: 'COMPLETED' },
            after: { strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED' },
          }),
        ],
        rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0 },
      },
    });
    renderCard();

    pasteAndPreview();

    const table = await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    const [, dataRow] = within(table).getAllByRole('row');
    expect(dataRow).toHaveTextContent('70 (-1)·Completed → 70 (-2)·Completed');
  });

  it('shows a dash for the strokes of a row with none, never the word "null"', async () => {
    previewEventGolfRoundScoresMock.mockResolvedValue({
      data: {
        rows: [
          previewRow({
            row: { playerName: 'Rory McIlroy', strokes: null, scoreToPar: -1, status: 'IN_PROGRESS' },
            change: 'SKIPPED',
            after: { strokes: null, scoreToPar: -1, thru: null, status: 'IN_PROGRESS' },
          }),
        ],
        rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0 },
      },
    });
    renderCard();

    pasteAndPreview();

    const table = await screen.findByTestId('root-admin-golf-scores-upload-preview-table');
    expect(table).not.toHaveTextContent('null');
    const [, dataRow] = within(table).getAllByRole('row');
    expect(dataRow).toHaveTextContent('— → — (-1)·In progress');
  });
});
