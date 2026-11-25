import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EventToolsTab } from './event-tools-tab';
import { EventTabOutlet } from './test/event-tab-outlet';
import { sportEventFixture, sportLeagueFixture } from './sport-test-fixtures';

// The Event page's Tools tab (#1890) on a test event: the field's bulk upload. A provider's events
// are linked by sync alone (#2004), so the tab offers no score-source link.

const {
  listSportLeaguesMock,
  getEventMock,
  listEventRoundsMock,
  releaseEventMock,
  transitionEventMock,
  updateEventMock,
  updateEventRoundsMock,
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
    listSportLeaguesMock: vi.fn(),
    getEventMock: vi.fn(),
    listEventRoundsMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    releaseEventMock: vi.fn(),
    transitionEventMock: vi.fn(),
    updateEventMock: vi.fn(),
    updateEventRoundsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  listSportLeagues: listSportLeaguesMock,
  getEvent: getEventMock,
  listEventRounds: listEventRoundsMock,
  listEventParticipants: listEventParticipantsMock,
  releaseEvent: releaseEventMock,
  transitionEvent: transitionEventMock,
  updateEvent: updateEventMock,
  updateEventRounds: updateEventRoundsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function tournament(overrides: Parameters<typeof sportEventFixture>[0] = {}) {
  return sportEventFixture({
    id: 'tour-1',
    name: 'Rolling Weekend Invitational',
    venue: 'Mock Golf Club',
    location: 'Augusta, GA',
    startDate: '2026-05-07T12:00:00.000Z',
    endDate: '2026-05-10T22:00:00.000Z',
    status: 'SCHEDULED',
    rounds: 4,
    eventSeriesId: 'event-series-1',
    sportLeagueSeasonId: 'season-2026',
    championshipYear: 2026,
    sportLeagueId: 'league-1',
    autoLifecycleEnabled: true,
    loadedParticipantCount: 120,
    tierCount: 6,
    adminCounts: { untieredParticipantCount: 0, unpricedParticipantCount: 0, emptyTierLabels: [], contestCount: 0 },
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T11:00:00.000Z',
    allowedTransitions: ['IN_PROGRESS', 'CANCELLED'],
    ...overrides,
  });
}

function seedDefaults() {
  getEventMock.mockResolvedValue({ data: { event: tournament() } });
  listEventRoundsMock.mockResolvedValue({
    data: {
      rounds: [
        { roundNumber: 1, scheduledDate: '2026-05-07T12:00:00.000Z', scheduledEndAt: '2026-05-07T22:00:00.000Z' },
        { roundNumber: 2, scheduledDate: '2026-05-08T12:00:00.000Z', scheduledEndAt: '' },
      ],
    },
  });
  listSportLeaguesMock.mockResolvedValue({
    data: { sportLeagues: [sportLeagueFixture({ id: 'league-1', name: 'PGA Tour' })] },
  });
  listEventParticipantsMock.mockResolvedValue({ data: { participants: [] } });
}

function renderPage(path = '/manage/sports/golf/events/tour-1/tools') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<EventTabOutlet />} path="/manage/sports/:sport/events/:eventId">
            <Route element={<EventToolsTab />} path="tools" />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('The Event page\'s Tools tab', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('offers the field\'s bulk upload on a test event, and no link to a provider\'s scores', async () => {
    seedDefaults();
    renderPage();

    expect(await screen.findByTestId('root-admin-event-field-upload-card')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-tools-tab')).not.toHaveTextContent(/score source/i);
  });
});
