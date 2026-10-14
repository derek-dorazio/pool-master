import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RaceResultPreviewResponse } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportEventResultsPage } from './root-admin-sport-event-results-page';
import { fieldEntryFixture, participantFixture, sportEventFixture } from './sport-test-fixtures';

// Issue 623: a horse race's results page: its stored finishing order and the card that loads it,
// chosen by the finish-position family's entry in the admin results registry
// (plans/racing-sports.md Q9.6).

const {
  getEventMock,
  listEventParticipantsMock,
  previewEventRaceResultsMock,
  applyEventRaceResultsMock,
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
    listEventParticipantsMock: vi.fn(),
    previewEventRaceResultsMock: vi.fn(),
    applyEventRaceResultsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  listEventParticipants: listEventParticipantsMock,
  previewEventRaceResults: previewEventRaceResultsMock,
  applyEventRaceResults: applyEventRaceResultsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const race = sportEventFixture({
  id: 'evt-1',
  sport: 'HORSE_RACING',
  name: 'Kentucky Derby',
  venue: 'Churchill Downs',
  status: 'IN_PROGRESS',
  rounds: 1,
  roundsPar: null,
  allowedTransitions: [],
});

const sovereignty = fieldEntryFixture({
  id: 'sep-1',
  participantId: 'p-1',
  participant: participantFixture({ id: 'p-1', name: 'Sovereignty', externalId: 'h-1' }),
});
const journalism = fieldEntryFixture({
  id: 'sep-2',
  participantId: 'p-2',
  participant: participantFixture({ id: 'p-2', name: 'Journalism', externalId: 'h-2' }),
});

function previewRow(
  name: string,
  id: string,
  finishPosition: number,
  overrides: Partial<RaceResultPreviewResponse['rows'][number]> = {},
): RaceResultPreviewResponse['rows'][number] {
  return {
    row: { playerName: name, resultStatus: 'FINISHED', finishPosition, startPosition: null, riderName: null },
    resolution: 'MATCHED',
    sportEventParticipantId: id,
    participantName: name,
    rowError: null,
    change: 'CREATE',
    before: null,
    after: { resultStatus: 'FINISHED', finishPosition, startPosition: null, riderName: null, isOfficial: true },
    ...overrides,
  };
}

function preview(
  rows: RaceResultPreviewResponse['rows'],
  orderErrors: RaceResultPreviewResponse['orderErrors'] = [],
): { data: RaceResultPreviewResponse } {
  return {
    data: {
      rows,
      orderErrors,
      rollup: { total: rows.length, matched: rows.length, unresolved: 0, ambiguous: 0, invalid: 0 },
    },
  };
}

function seed(participants = [sovereignty, journalism]) {
  getEventMock.mockResolvedValue({ data: { event: race } });
  listEventParticipantsMock.mockResolvedValue({ data: { participants } });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports/horse-racing/events/evt-1/results']}>
        <Routes>
          <Route element={<RootAdminSportEventResultsPage />} path="/manage/sports/:sport/events/:eventId/results" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function pasteAndPreview(text: string) {
  await userEvent.type(await screen.findByTestId('root-admin-race-result-upload-textarea'), text);
  await userEvent.click(screen.getByTestId('root-admin-race-result-upload-preview'));
  return screen.findByTestId('root-admin-race-result-upload-preview-table');
}

describe('RootAdminSportEventResultsPage for a horse race', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('shows the finishing-order card, not golf round scores, and says no result is in yet', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-race-results-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-race-result-empty')).toHaveTextContent(
      'No results yet. Load the finishing order below once the race is run.',
    );
    expect(screen.queryByTestId('root-admin-golf-scores-upload-textarea')).not.toBeInTheDocument();
  });

  it('lists the stored result in finishing order with a provisional badge until it is official', async () => {
    seed([
      { ...journalism, race: { finishPosition: 2, startPosition: 8, resultStatus: 'FINISHED', isOfficial: false, riderName: 'U. Rispoli' } },
      { ...sovereignty, race: { finishPosition: 1, startPosition: 18, resultStatus: 'FINISHED', isOfficial: false, riderName: 'J. Alvarado' } },
    ]);
    renderPage();

    const table = await screen.findByTestId('root-admin-race-result-table');
    expect(within(table).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual([
      '1stSovereignty18J. Alvarado',
      '2ndJournalism8U. Rispoli',
    ]);
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Finish', 'Horse', 'Start', 'Rider']);
    expect(screen.getByTestId('root-admin-race-result-official')).toHaveTextContent('Provisional');
  });

  it('shows an official badge once the stored result is official, and a non-finisher by how its race ended', async () => {
    seed([
      { ...sovereignty, race: { finishPosition: 1, startPosition: null, resultStatus: 'FINISHED', isOfficial: true, riderName: null } },
      { ...journalism, race: { finishPosition: null, startPosition: null, resultStatus: 'DID_NOT_FINISH', isOfficial: true, riderName: null } },
    ]);
    renderPage();

    expect(await screen.findByTestId('root-admin-race-result-official')).toHaveTextContent('Official');
    expect(screen.getByTestId('root-admin-race-result-finish-sep-2')).toHaveTextContent('Did not finish');
  });

  it('starts the official box ticked when the stored result is official, so a correction keeps it official', async () => {
    seed([
      { ...sovereignty, race: { finishPosition: 1, startPosition: null, resultStatus: 'FINISHED', isOfficial: true, riderName: null } },
      { ...journalism, race: { finishPosition: 2, startPosition: null, resultStatus: 'FINISHED', isOfficial: true, riderName: null } },
    ]);
    renderPage();

    expect(await screen.findByTestId('root-admin-race-result-official')).toHaveTextContent('Official');
    expect(screen.getByTestId('root-admin-race-result-mark-official')).toBeChecked();

    previewEventRaceResultsMock.mockResolvedValue(preview([previewRow('Journalism', 'sep-2', 2)]));
    applyEventRaceResultsMock.mockResolvedValue({ data: { participants: [sovereignty, journalism] } });
    await pasteAndPreview('playerName,finishPosition\nJournalism,2');
    const apply = screen.getByTestId('root-admin-race-result-upload-apply');
    expect(apply).toHaveTextContent('Apply official result');
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);

    await waitFor(() => expect(applyEventRaceResultsMock).toHaveBeenCalledWith(expect.objectContaining({
      body: {
        isOfficial: true,
        rows: [{ playerName: 'Journalism', resultStatus: 'FINISHED', finishPosition: 2, startPosition: null, riderName: null }],
      },
    })));
  });

  it('offers no finishing-order card while the field cannot be read, so a correction never applies blind', async () => {
    getEventMock.mockResolvedValue({ data: { event: race } });
    listEventParticipantsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'down' } } });
    renderPage();

    expect(await screen.findByTestId('root-admin-race-result-field-error')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-race-result-mark-official')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-race-result-upload-textarea')).not.toBeInTheDocument();
  });

  it('starts the official box unticked when the stored result is provisional', async () => {
    seed([
      { ...sovereignty, race: { finishPosition: 1, startPosition: null, resultStatus: 'FINISHED', isOfficial: false, riderName: null } },
    ]);
    renderPage();

    expect(await screen.findByTestId('root-admin-race-result-official')).toHaveTextContent('Provisional');
    expect(screen.getByTestId('root-admin-race-result-mark-official')).not.toBeChecked();
  });

  it('previews then applies a pasted finishing order as official when the admin marks it so', async () => {
    seed();
    previewEventRaceResultsMock.mockResolvedValue(preview([
      previewRow('Sovereignty', 'sep-1', 1),
      previewRow('Journalism', 'sep-2', 2),
    ]));
    applyEventRaceResultsMock.mockResolvedValue({ data: { participants: [sovereignty, journalism] } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-race-result-mark-official'));
    const table = await pasteAndPreview('playerName,finishPosition\nSovereignty,1\nJournalism,2');

    expect(within(table).getByText('1st')).toBeInTheDocument();
    expect(previewEventRaceResultsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1' },
      body: {
        isOfficial: true,
        rows: [
          { playerName: 'Sovereignty', resultStatus: 'FINISHED', finishPosition: 1, startPosition: null, riderName: null },
          { playerName: 'Journalism', resultStatus: 'FINISHED', finishPosition: 2, startPosition: null, riderName: null },
        ],
      },
    }));

    const apply = screen.getByTestId('root-admin-race-result-upload-apply');
    expect(apply).toHaveTextContent('Apply official result');
    await waitFor(() => expect(apply).toBeEnabled());
    const fieldReadsBeforeApply = listEventParticipantsMock.mock.calls.length;
    await userEvent.click(apply);

    await waitFor(() => expect(applyEventRaceResultsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'evt-1' },
      body: {
        isOfficial: true,
        rows: [
          { playerName: 'Sovereignty', resultStatus: 'FINISHED', finishPosition: 1, startPosition: null, riderName: null },
          { playerName: 'Journalism', resultStatus: 'FINISHED', finishPosition: 2, startPosition: null, riderName: null },
        ],
      },
    })));
    // The field is read again so the stored result shows what was applied.
    await waitFor(() =>
      expect(listEventParticipantsMock.mock.calls.length).toBeGreaterThan(fieldReadsBeforeApply),
    );
  });

  it('blocks Apply and explains the rule when the previewed places do not run 1, 2, 3', async () => {
    seed();
    previewEventRaceResultsMock.mockResolvedValue(preview(
      [previewRow('Sovereignty', 'sep-1', 1), previewRow('Journalism', 'sep-2', 3)],
      ['POSITIONS_INVALID'],
    ));
    renderPage();

    await pasteAndPreview('playerName,finishPosition\nSovereignty,1\nJournalism,3');

    expect(screen.getByTestId('root-admin-race-result-order-error-POSITIONS_INVALID')).toHaveTextContent(
      'The places do not run 1, 2, 3 and on.',
    );
    expect(screen.getByTestId('root-admin-race-result-upload-apply')).toBeDisabled();
    expect(applyEventRaceResultsMock).not.toHaveBeenCalled();
  });

  it('blocks Apply when a previewed row names a runner not in the field', async () => {
    seed();
    previewEventRaceResultsMock.mockResolvedValue(preview([
      previewRow('Ghost', '', 1, { resolution: 'UNRESOLVED', sportEventParticipantId: null, participantName: null, change: null }),
    ]));
    renderPage();

    const table = await pasteAndPreview('playerName,finishPosition\nGhost,1');

    expect(within(table).getByText('Not in the field')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-race-result-upload-unresolved')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-race-result-upload-apply')).toBeDisabled();
  });

  it('shows the order rule when the server refuses an official result whose field is incomplete', async () => {
    seed();
    previewEventRaceResultsMock.mockResolvedValue(preview([previewRow('Sovereignty', 'sep-1', 1)]));
    applyEventRaceResultsMock.mockResolvedValue({
      error: { error: { code: 'RACE_RESULT_FIELD_INCOMPLETE', message: 'Field incomplete' } },
      response: { status: 422 },
    });
    renderPage();

    await pasteAndPreview('playerName,finishPosition\nSovereignty,1');
    const apply = screen.getByTestId('root-admin-race-result-upload-apply');
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);

    expect(await screen.findByTestId('root-admin-race-result-upload-apply-error')).toHaveTextContent(
      'An official result needs every horse still in the field',
    );
  });
});

describe('RootAdminSportEventResultsPage for an auto race', () => {
  const autoRace = sportEventFixture({ ...race, sport: 'AUTO_RACING', name: 'Daytona 500', venue: 'Daytona International Speedway' });

  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('heads the stored result Finish, Driver and Start, with no Rider column because the result names only the driver', async () => {
    getEventMock.mockResolvedValue({ data: { event: autoRace } });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [
      { ...sovereignty, race: { finishPosition: 1, startPosition: 4, resultStatus: 'FINISHED', isOfficial: true, riderName: null } },
    ] } });
    renderPage();

    const table = await screen.findByTestId('root-admin-race-result-table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Finish', 'Driver', 'Start']);
    expect(within(table).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual(['1stSovereignty4']);
  });

  it('says every driver needs a result when the server refuses an official result whose field is incomplete', async () => {
    getEventMock.mockResolvedValue({ data: { event: autoRace } });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [sovereignty, journalism] } });
    previewEventRaceResultsMock.mockResolvedValue(preview([previewRow('Sovereignty', 'sep-1', 1)]));
    applyEventRaceResultsMock.mockResolvedValue({
      error: { error: { code: 'RACE_RESULT_FIELD_INCOMPLETE', message: 'Field incomplete' } },
      response: { status: 422 },
    });
    renderPage();

    await pasteAndPreview('playerName,finishPosition\nSovereignty,1');
    expect(screen.getByTestId('root-admin-race-results-panel')).toHaveTextContent('a place for each driver that finished');
    const apply = screen.getByTestId('root-admin-race-result-upload-apply');
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);

    expect(await screen.findByTestId('root-admin-race-result-upload-apply-error')).toHaveTextContent(
      'An official result needs every driver still in the field: a place for each finisher, or how its race ended.',
    );
  });
});

describe('RootAdminSportEventResultsPage for a cycling race', () => {
  const cyclingRace = sportEventFixture({ ...race, sport: 'CYCLING', name: 'Tour de France', venue: 'France' });

  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('heads the final overall order Finish, Rider and Start with no second rider column, and shows an abandon as Did not finish', async () => {
    getEventMock.mockResolvedValue({ data: { event: cyclingRace } });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [
      { ...journalism, race: { finishPosition: null, startPosition: null, resultStatus: 'DID_NOT_FINISH', isOfficial: true, riderName: null } },
      { ...sovereignty, race: { finishPosition: 1, startPosition: null, resultStatus: 'FINISHED', isOfficial: true, riderName: null } },
    ] } });
    renderPage();

    const table = await screen.findByTestId('root-admin-race-result-table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Finish', 'Rider', 'Start']);
    expect(within(table).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual([
      '1stSovereignty—',
      'Did not finishJournalism—',
    ]);
  });

  it('asks for a place for each rider that finished, and says every rider needs a result when the server refuses an incomplete official result', async () => {
    getEventMock.mockResolvedValue({ data: { event: cyclingRace } });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [sovereignty, journalism] } });
    previewEventRaceResultsMock.mockResolvedValue(preview([previewRow('Sovereignty', 'sep-1', 1)]));
    applyEventRaceResultsMock.mockResolvedValue({
      error: { error: { code: 'RACE_RESULT_FIELD_INCOMPLETE', message: 'Field incomplete' } },
      response: { status: 422 },
    });
    renderPage();

    await pasteAndPreview('playerName,finishPosition\nSovereignty,1');
    expect(screen.getByTestId('root-admin-race-results-panel')).toHaveTextContent('a place for each rider that finished, or DNF, DQ or DNS');
    const apply = screen.getByTestId('root-admin-race-result-upload-apply');
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);

    expect(await screen.findByTestId('root-admin-race-result-upload-apply-error')).toHaveTextContent(
      'An official result needs every rider still in the field: a place for each finisher, or how its race ended.',
    );
  });
});
