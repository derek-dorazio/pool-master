import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SportEventParticipantUploadPreviewResponse } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { bindApiMocks } from '@/test/msw-api';
import { GolfFieldUploadCard } from './golf-field-upload-card';
import { fieldEntryFixture, participantFixture } from './golf-test-fixtures';

// The Field editor's bulk upload card: paste rows, preview how each resolves against the
// field and what it changes, and apply only when every row names one golfer on the field.

const { previewMock, applyMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return { previewMock: vi.fn(), applyMock: vi.fn(), mockLogger: logger };
});

bindApiMocks({
  previewEventParticipantUpload: previewMock,
  applyEventParticipantUpload: applyMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const ROWS_CSV = 'externalId,playerName,ranking,oddsToWin\n,Rory McIlroy,1,null\n,Ghost Golfer,5,';

const values = (overrides: Partial<NonNullable<SportEventParticipantUploadPreviewResponse['rows'][number]['after']>> = {}) => ({
  isActive: true,
  inactiveReason: null,
  ranking: 2,
  oddsToWin: 8.5,
  seedNumber: 2,
  ...overrides,
});

const matchedRow = {
  row: { playerName: 'Rory McIlroy', ranking: 1, oddsToWin: null },
  resolution: 'MATCHED' as const,
  participantId: '00000000-0000-4000-8000-000000000001',
  participantName: 'Rory McIlroy',
  sportEventParticipantId: '00000000-0000-4000-8000-000000000002',
  rowError: null,
  change: 'UPDATE' as const,
  before: values(),
  after: values({ ranking: 1, oddsToWin: null }),
  message: null,
};

const unresolvedRow = {
  row: { playerName: 'Ghost Golfer', ranking: 5 },
  resolution: 'UNRESOLVED' as const,
  participantId: null,
  participantName: null,
  sportEventParticipantId: null,
  rowError: null,
  change: null,
  before: null,
  after: null,
  message: 'No participant on this event\'s field matches playerName "Ghost Golfer". Refresh the field from the provider first.',
};

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const entries = [
    fieldEntryFixture({ id: 'sep-rory', participant: participantFixture({ name: 'Rory McIlroy' }) }),
  ];
  render(
    <QueryClientProvider client={queryClient}>
      <GolfFieldUploadCard entries={entries} eventId="evt-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

async function pasteAndPreview(csv: string) {
  await userEvent.type(await screen.findByTestId('root-admin-golf-field-upload-textarea'), csv);
  await userEvent.click(screen.getByTestId('root-admin-golf-field-upload-preview'));
  await screen.findByTestId('root-admin-golf-field-upload-preview-table');
}

describe('GolfFieldUploadCard', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('sends the pasted rows with blank cells omitted and "null" as a clear, then shows each row\'s resolution, before → after and the rollup', async () => {
    previewMock.mockResolvedValue({
      data: {
        rows: [matchedRow, unresolvedRow],
        rollup: { total: 2, matched: 1, unresolved: 1, ambiguous: 0, duplicate: 0, update: 1, unchanged: 0 },
      },
    });
    renderCard();

    await pasteAndPreview(ROWS_CSV);

    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1' },
      body: { rows: [{ playerName: 'Rory McIlroy', ranking: 1, oddsToWin: null }, { playerName: 'Ghost Golfer', ranking: 5 }] },
    }));
    const matched = screen.getByTestId('root-admin-golf-field-upload-row-0');
    expect(within(matched).getByText('MATCHED')).toBeInTheDocument();
    expect(within(matched).getByText('UPDATE')).toBeInTheDocument();
    expect(matched).toHaveTextContent('#2 · odds 8.5 · seed 2 → #1 · no odds · seed 2');
    const unresolved = screen.getByTestId('root-admin-golf-field-upload-row-1');
    expect(unresolved).toHaveTextContent('UNRESOLVED');
    expect(unresolved).toHaveTextContent('Refresh the field from the provider first');
    expect(screen.getByTestId('root-admin-golf-field-upload-rollup')).toHaveTextContent('2 rows · 1 matched · 1 not on the field');
  });

  it('keeps Apply disabled while any previewed row is unresolved or a duplicate', async () => {
    previewMock.mockResolvedValue({
      data: {
        rows: [{ ...matchedRow, rowError: 'DUPLICATE_PARTICIPANT', change: null, after: null }, unresolvedRow],
        rollup: { total: 2, matched: 1, unresolved: 1, ambiguous: 0, duplicate: 1, update: 0, unchanged: 0 },
      },
    });
    renderCard();

    await pasteAndPreview(ROWS_CSV);

    expect(screen.getByTestId('root-admin-golf-field-upload-unresolved')).toHaveTextContent('2 rows cannot be applied');
    expect(screen.getByText('DUPLICATE')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-golf-field-upload-apply')).toBeDisabled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('applies a fully matched upload through the SDK and refreshes the field the grid reads', async () => {
    previewMock.mockResolvedValue({
      data: {
        rows: [matchedRow],
        rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0, duplicate: 0, update: 1, unchanged: 0 },
      },
    });
    applyMock.mockResolvedValue({ data: { participants: [] } });
    const { invalidate } = renderCard();

    await pasteAndPreview('playerName,ranking,oddsToWin\nRory McIlroy,1,null');
    await waitFor(() => expect(screen.getByTestId('root-admin-golf-field-upload-apply')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-golf-field-upload-apply'));

    await waitFor(() => expect(applyMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1' },
      body: { rows: [{ playerName: 'Rory McIlroy', ranking: 1, oddsToWin: null }] },
    })));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: QueryKeys.rootAdmin.golf.field('evt-1') }));
  });

  it('surfaces the server\'s refusal when an apply is rejected', async () => {
    previewMock.mockResolvedValue({
      data: {
        rows: [matchedRow],
        rollup: { total: 1, matched: 1, unresolved: 0, ambiguous: 0, duplicate: 0, update: 1, unchanged: 0 },
      },
    });
    applyMock.mockResolvedValue({
      error: { error: { code: 'EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED', message: '1 field upload row(s) cannot be applied.' } },
      response: { status: 422 },
    });
    renderCard();

    await pasteAndPreview('playerName,ranking\nRory McIlroy,1');
    await waitFor(() => expect(screen.getByTestId('root-admin-golf-field-upload-apply')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-golf-field-upload-apply'));

    expect(await screen.findByTestId('root-admin-golf-field-upload-apply-error')).toHaveTextContent('cannot be applied');
  });

  it('rejects a row that names no golfer before calling the server', async () => {
    renderCard();

    await userEvent.type(await screen.findByTestId('root-admin-golf-field-upload-textarea'), 'ranking\n4');
    await userEvent.click(screen.getByTestId('root-admin-golf-field-upload-preview'));

    expect(await screen.findByTestId('root-admin-golf-field-upload-parse-error')).toHaveTextContent('participantId, externalId, or playerName');
    expect(previewMock).not.toHaveBeenCalled();
  });
});
