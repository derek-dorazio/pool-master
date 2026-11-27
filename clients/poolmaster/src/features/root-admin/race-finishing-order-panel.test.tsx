import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EventRoundsTab } from './event-rounds-tab';
import { EventTabOutlet } from './test/event-tab-outlet';
import { fieldEntryFixture, participantFixture, sportEventFixture } from './sport-test-fixtures';

// Issue 623: a horse race's results page: its stored finishing order, chosen by the
// finish-position family's entry in the admin results registry (plans/racing-sports.md Q9.6). The
// result comes from the feed, so the page offers no upload (#2008).

const {
  getEventMock,
  listEventParticipantsMock,
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
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  listEventParticipants: listEventParticipantsMock,
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
  participant: participantFixture({ id: 'p-1', name: 'Sovereignty' }),
});
const journalism = fieldEntryFixture({
  id: 'sep-2',
  participantId: 'p-2',
  participant: participantFixture({ id: 'p-2', name: 'Journalism' }),
});

function seed(participants = [sovereignty, journalism]) {
  getEventMock.mockResolvedValue({ data: { event: race } });
  listEventParticipantsMock.mockResolvedValue({ data: { participants } });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports/horse-racing/events/evt-1/rounds']}>
        <Routes>
          <Route element={<EventTabOutlet />} path="/manage/sports/:sport/events/:eventId">
            <Route element={<EventRoundsTab />} path="rounds" />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('The Rounds and matches tab for a horse race', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('shows the race\'s result, not golf round scores, and says no result is in yet because it comes from the feed', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-race-results-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-race-result-empty')).toHaveTextContent(
      'No results yet. The race\'s result comes from the feed once it is run.',
    );
    expect(screen.queryByTestId('root-admin-golf-tournament-scores-page')).not.toBeInTheDocument();
  });

  it('offers no way to paste or upload a finishing order: the result comes from the feed', async () => {
    seed();
    renderPage();

    await screen.findByTestId('root-admin-race-results-panel');
    expect(screen.queryByTestId('root-admin-race-result-upload-textarea')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-race-result-mark-official')).not.toBeInTheDocument();
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
});

describe('The Rounds and matches tab for an auto race', () => {
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
});

describe('The Rounds and matches tab for a cycling race', () => {
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
});

describe('The Rounds and matches tab for a running race', () => {
  const marathon = sportEventFixture({ ...race, sport: 'RUNNING', name: 'Boston Marathon', venue: 'Boston' });

  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('heads the finishing order Finish, Runner and Start with no rider column, and shows a dropout as Did not finish', async () => {
    getEventMock.mockResolvedValue({ data: { event: marathon } });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [
      { ...journalism, race: { finishPosition: null, startPosition: null, resultStatus: 'DID_NOT_FINISH', isOfficial: true, riderName: null } },
      { ...sovereignty, race: { finishPosition: 1, startPosition: null, resultStatus: 'FINISHED', isOfficial: true, riderName: null } },
    ] } });
    renderPage();

    const table = await screen.findByTestId('root-admin-race-result-table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Finish', 'Runner', 'Start']);
    expect(within(table).getAllByRole('row').slice(1).map((row) => row.textContent)).toEqual([
      '1stSovereignty—',
      'Did not finishJournalism—',
    ]);
  });
});
