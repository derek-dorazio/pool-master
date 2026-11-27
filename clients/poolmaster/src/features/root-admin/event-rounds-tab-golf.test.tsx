import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EventRoundsTab } from './event-rounds-tab';
import { EventTabOutlet } from './test/event-tab-outlet';
import {
  fieldEntryFixture,
  participantFixture,
  sportEventFixture,
  sportEventRoundFixture,
} from './sport-test-fixtures';

// plans/124 §6.3 — a golf event's results page: round scores (pool-master-r11), chosen by the
// stroke-play family's entry in the admin results registry (plans/racing-sports.md Q9.6).

const {
  getEventMock,
  listEventRoundsMock,
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
    listEventRoundsMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  listEventRounds: listEventRoundsMock,
  listEventParticipants: listEventParticipantsMock,
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
    roundCount: 4,
    sportLeagueSeasonId: 'season-2026',
    championshipYear: 2026,
    sportLeagueId: 'league-1',
    autoLifecycleEnabled: true,
    participantCount: 2,
    tierCount: 6,
    adminCounts: { untieredParticipantCount: 0, unpricedParticipantCount: 0, emptyTierNumbers: [], contestCount: 1 },
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
    status: 'COMPLETED' as const,
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
          participant: participantFixture({ id: 'p-1', name: 'Rory McIlroy' }),
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
      <MemoryRouter initialEntries={['/manage/sports/golf/events/evt-1/rounds']}>
        <Routes>
          <Route element={<EventTabOutlet />} path="/manage/sports/:sport/events/:eventId">
            <Route element={<EventRoundsTab />} path="rounds" />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-r11 Rounds and matches tab for a golf event', () => {
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
    // The round's corrections render; there is no score upload, since scores come from the feed (#2008).
    expect(await screen.findByText('Rory McIlroy')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-scores-upload-textarea')).not.toBeInTheDocument();
  });

  it('pool-master-r11 shows the sync-tick alert for a provider-synced tournament but keeps the tools usable', async () => {
    seed({ tournament: { isTestData: false } });
    renderPage();

    expect(await screen.findByTestId('root-admin-golf-scores-sync-alert')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-golf-scores-strokes-sep-1')).toBeInTheDocument();
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

  it('pool-master-r11 clears a typed correction when the round changes (key remount)', async () => {
    seed();
    renderPage();

    const strokes = await screen.findByTestId('root-admin-golf-scores-strokes-sep-1');
    await userEvent.clear(strokes);
    await userEvent.type(strokes, '65');
    expect(screen.getByTestId('root-admin-golf-scores-save-sep-1')).toBeEnabled();

    // Switch rounds -> the corrections card remounts and the typed correction is reset.
    await userEvent.click(screen.getByRole('radio', { name: /Round 2/ }));

    await waitFor(() => expect(screen.getByTestId('root-admin-golf-scores-strokes-sep-1')).toHaveValue('70'));
    expect(screen.getByTestId('root-admin-golf-scores-save-sep-1')).toBeDisabled();
  });

  it('pool-master-r11 surfaces a round-schedule load error in the Rounds grid and the scores panel without blocking the tools', async () => {
    seed();
    listEventRoundsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Round schedule offline' } },
      response: { status: 500 },
    });
    renderPage();

    // Both the Rounds grid and the scores panel read the schedule, and each says it failed.
    // findAllByText settles on the first panel to fail, so wait until both have.
    await waitFor(() => expect(screen.getAllByText('Something went wrong. Please try again.')).toHaveLength(2));
    // Rounds fall back to numbered options from tournament.rounds.
    expect(screen.getByRole('radio', { name: 'Round 1' })).toBeInTheDocument();
  });

  it('says the field could not load, so the round\'s scores show as failed', async () => {
    seed();
    listEventParticipantsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Field offline' } },
      response: { status: 500 },
    });
    renderPage();

    expect(await screen.findByTestId('root-admin-golf-scores-corrections-error')).toBeInTheDocument();
  });

  it('says a tournament with no rounds has none scheduled, and offers no round tools', async () => {
    seed({ tournament: { roundCount: 0 } });
    listEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });
    renderPage();

    expect(await screen.findByTestId('root-admin-golf-scores-no-rounds')).toHaveTextContent('This tournament has no rounds scheduled yet.');
    expect(screen.queryByTestId('root-admin-golf-scores-corrections-error')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
