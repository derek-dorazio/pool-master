import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminEventsPage } from './root-admin-events-page';
import { sportEventFixture } from './sport-test-fixtures';

const { listEventsMock, mockLogger } = vi.hoisted(() => {
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
    listEventsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  listEvents: listEventsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminEventsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-33l.12: RootAdminEventsPage', () => {
  afterEach(() => {
    listEventsMock.mockReset();
    mockLogger.info.mockReset();
  });

  it('pool-master-33l.12 renders current persisted event state separately from sync-run history', async () => {
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            externalId: 'golf-major-2026-weekend',
            providerId: 'mock-contest-feed',
            sport: 'GOLF',
            name: 'Rolling Weekend Invitational',
            venue: 'Mock Golf Club',
            location: 'Augusta, GA',
            status: 'SCHEDULED',
            startDate: '2026-05-07T12:00:00.000Z',
            endDate: '2026-05-10T22:00:00.000Z',
            participantCount: 144,
            loadedParticipantCount: 72,
            readinessStatus: 'PENDING_FIELD',
            readinessReasons: ['FIELD_NOT_LOADED'],
            contestEligible: false,
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T11:00:00.000Z',
          },
        ],
      },
    });

    renderPage();

    expect(await screen.findByTestId('root-admin-events-page')).toBeVisible();
    expect(await screen.findByText('Rolling Weekend Invitational')).toBeInTheDocument();
    expect(screen.getByText('mock-contest-feed')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('Provider count 144')).toBeInTheDocument();
    expect(screen.getByText('Pending Field')).toBeInTheDocument();

    // #235 — the canonical list, unpaged: no limit is sent (§16). It reads this year (#1180).
    await waitFor(() => expect(listEventsMock).toHaveBeenCalled());
    const [options] = listEventsMock.mock.calls.at(-1) as [{ query?: unknown } | undefined];
    expect(options?.query).toEqual({ eventYear: new Date().getFullYear() });
  });

  it('opens on this year\'s events and reads another year when one is chosen', async () => {
    const currentYear = new Date().getFullYear();
    listEventsMock.mockResolvedValue({ data: { events: [] } });

    renderPage();

    expect(await screen.findByText(`No events in ${currentYear}.`)).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-events-year')).toHaveValue(String(currentYear));

    fireEvent.change(screen.getByTestId('root-admin-events-year'), {
      target: { value: String(currentYear - 1) },
    });

    expect(await screen.findByText(`No events in ${currentYear - 1}.`)).toBeInTheDocument();
    expect(listEventsMock).toHaveBeenCalledTimes(2);
    const [options] = listEventsMock.mock.calls.at(-1) as [{ query?: unknown } | undefined];
    expect(options?.query).toEqual({ eventYear: currentYear - 1 });
  });

  it("links each event's Participants button to that event's Field page in its sport's Manage section", async () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    listEventsMock.mockResolvedValue({
      data: { events: [sportEventFixture({ id: eventId, name: 'Rolling Weekend Invitational', sport: 'GOLF' })] },
    });

    renderPage();

    expect(await screen.findByTestId(`root-admin-event-participants-${eventId}`)).toHaveAttribute(
      'href',
      `/manage/sports/golf/events/${eventId}/field`,
    );
  });
});

describe('RootAdminEventsPage states and fallbacks', () => {
  const eventId = 'evt-browse-1';

  afterEach(() => {
    listEventsMock.mockReset();
  });

  function refusal(code: string, message: string, status = 500) {
    return { error: { error: { code, message } }, response: { status } };
  }

  function seedOneEvent(overrides: Parameters<typeof sportEventFixture>[0] = {}) {
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          sportEventFixture({
            id: eventId,
            name: 'Spring Classic',
            providerId: 'mock-contest-feed',
            startDate: '2026-03-12T13:00:00.000Z',
            ...overrides,
          }),
        ],
      },
    });
  }

  it('shows the server\'s reason in place of the grid when the event list cannot be loaded', async () => {
    listEventsMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The event store is unavailable.'));
    renderPage();

    expect(await screen.findByText('The event store is unavailable.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-events-table')).not.toBeInTheDocument();
  });

  it('reads an unknown provider count and lists no readiness reasons for a contest-eligible event', async () => {
    seedOneEvent({
      participantCount: null,
      readinessStatus: 'CONTEST_ELIGIBLE',
      readinessReasons: [],
      contestEligible: true,
    });
    renderPage();

    const row = await screen.findByTestId(`root-admin-event-row-${eventId}`);
    expect(within(row).getByText('Provider count unknown')).toBeInTheDocument();
    expect(within(row).getByText('Contest Eligible')).toBeInTheDocument();
    expect(within(row).queryByText(/EVENT_NOT_RELEASED|FIELD_NOT_LOADED/)).not.toBeInTheDocument();
  });

  it('lists the readiness reasons of an unreleased event under its readiness', async () => {
    seedOneEvent({ readinessStatus: 'NOT_RELEASED', readinessReasons: ['EVENT_NOT_RELEASED', 'FIELD_NOT_LOADED'] });
    renderPage();

    const row = await screen.findByTestId(`root-admin-event-row-${eventId}`);
    expect(within(row).getByText('Not Released')).toBeInTheDocument();
    expect(within(row).getByText('EVENT_NOT_RELEASED, FIELD_NOT_LOADED')).toBeInTheDocument();
  });
});
