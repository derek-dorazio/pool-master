import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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

describe('Rounds and matches tab for a golf event', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('lists the event\'s four rounds and offers no score entry or correction, since scores come from the feed, or the test-data loader on a test event', async () => {
    seed();
    renderPage();

    for (const roundNumber of [1, 2, 3, 4]) {
      expect(await screen.findByTestId(`root-admin-event-round-${String(roundNumber)}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('root-admin-golf-tournament-scores-page')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Round' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says the round schedule could not load in the Rounds grid', async () => {
    seed();
    listEventRoundsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Round schedule offline' } },
      response: { status: 500 },
    });
    renderPage();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-event-round-1')).not.toBeInTheDocument();
  });
});
