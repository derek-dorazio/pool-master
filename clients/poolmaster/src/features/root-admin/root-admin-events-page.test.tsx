import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminEventsPage } from './root-admin-events-page';
import {
  fieldEntryFixture,
  participantFixture,
  sportEventFixture,
  tierFixture,
  valuationFixture,
} from './golf-test-fixtures';

const { listEventParticipantsMock, listEventTiersMock, listEventsMock, mockLogger } = vi.hoisted(() => {
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
    listEventParticipantsMock: vi.fn(),
    listEventTiersMock: vi.fn(),
    listEventsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  listEventParticipants: listEventParticipantsMock,
  listEventTiers: listEventTiersMock,
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
      <RootAdminEventsPage />
    </QueryClientProvider>,
  );
}

describe('pool-master-33l.12: RootAdminEventsPage', () => {
  afterEach(() => {
    listEventParticipantsMock.mockReset();
    listEventTiersMock.mockReset();
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

    // #235 — the canonical list, unpaged: no limit is sent (§16).
    await waitFor(() => expect(listEventsMock).toHaveBeenCalled());
    const [options] = listEventsMock.mock.calls.at(-1) as [{ query?: unknown } | undefined];
    expect(options?.query).toBeUndefined();
  });

  it('pool-master-33l.12 opens a participant grid modal for the selected current-state event', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: eventId,
            externalId: 'golf-major-2026-weekend',
            providerId: 'mock-contest-feed',
            sport: 'GOLF',
            name: 'Rolling Weekend Invitational',
            status: 'IN_PROGRESS',
            startDate: '2026-05-07T12:00:00.000Z',
            loadedParticipantCount: 1,
            readinessStatus: 'EVENT_STARTED',
            readinessReasons: ['EVENT_STARTED'],
            contestEligible: false,
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T11:00:00.000Z',
          },
        ],
      },
    });
    // #236: the field is the shared SportEventParticipant read; the tier label comes from
    // the event's tiers, the score from the golf standing.
    listEventTiersMock.mockResolvedValue({
      data: { tiers: [tierFixture({ id: 'tier-a', sportEventId: eventId, tierKey: 'A', label: 'A' })] },
    });
    listEventParticipantsMock.mockResolvedValue({
      data: {
        participants: [
          fieldEntryFixture({
            id: '22222222-2222-4222-8222-222222222222',
            sportEventId: eventId,
            participantId: '33333333-3333-4333-8333-333333333333',
            participant: participantFixture({
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Avery Driver',
              shortName: 'A. Driver',
            }),
            ranking: 3,
            oddsToWin: 12.5,
            valuation: valuationFixture({ sportEventTierId: 'tier-a', tierOrderIndex: 1, price: 19 }),
            standing: {
              id: 'standing-1',
              position: 1,
              displayPosition: '1',
              status: 'ACTIVE',
              asOf: null,
              currentRound: 2,
              golf: { eventScoreToPar: -3, eventStrokes: 141, currentRoundThru: 18 },
            },
            rounds: [
              { id: 'r1', sportEventRoundId: 'round-1', roundNumber: 1, status: 'COMPLETED', completedAt: null, golf: { strokes: 70, scoreToPar: -2, thru: 18 } },
              { id: 'r2', sportEventRoundId: 'round-2', roundNumber: 2, status: 'COMPLETED', completedAt: null, golf: { strokes: 71, scoreToPar: -1, thru: 18 } },
            ],
          }),
          fieldEntryFixture({
            id: '44444444-4444-4444-8444-444444444444',
            sportEventId: eventId,
            participantId: '55555555-5555-4555-8555-555555555555',
            participant: participantFixture({ id: '55555555-5555-4555-8555-555555555555', name: 'Level Par Player' }),
            isActive: false,
            inactiveReason: 'ELIMINATED',
            standing: {
              id: 'standing-2',
              position: null,
              displayPosition: null,
              status: 'ELIMINATED',
              asOf: null,
              currentRound: 1,
              golf: { eventScoreToPar: 0, eventStrokes: 72, currentRoundThru: 18 },
            },
            rounds: [
              { id: 'r3', sportEventRoundId: 'round-1', roundNumber: 1, status: 'COMPLETED', completedAt: null, golf: { strokes: 72, scoreToPar: 0, thru: 18 } },
            ],
          }),
        ],
      },
    });

    renderPage();

    fireEvent.click(
      await screen.findByTestId(`root-admin-event-participants-${eventId}`),
    );

    const modal = await screen.findByTestId('root-admin-event-participants-modal');
    expect(within(modal).getByText('Rolling Weekend Invitational')).toBeInTheDocument();
    expect(await within(modal).findByText('Avery Driver')).toBeInTheDocument();
    expect(within(modal).getByText('A. Driver')).toBeInTheDocument();
    expect(within(modal).getByText('3')).toBeInTheDocument();
    expect(within(modal).getByText('12.5')).toBeInTheDocument();
    expect(within(modal).getByText('-3')).toBeInTheDocument();
    expect(within(modal).getByText('2 rounds, strokes 141')).toBeInTheDocument();
    // Level par renders "E", as on the contest entry page and the leaderboard.
    expect(within(modal).getByText('E')).toBeInTheDocument();
    expect(within(modal).queryByText('0')).not.toBeInTheDocument();
    // The tier label comes from the event's tiers; a golfer who missed the cut reads "Cut".
    expect(within(modal).getByText('A')).toBeInTheDocument();
    expect(within(modal).getByText('Cut')).toBeInTheDocument();
    expect(listEventParticipantsMock).toHaveBeenLastCalledWith({
      path: { eventId },
    });
  });
});

describe('RootAdminEventsPage states, fallbacks and the participant dialog', () => {
  const eventId = 'evt-browse-1';

  afterEach(() => {
    listEventParticipantsMock.mockReset();
    listEventTiersMock.mockReset();
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

  it('shows each golfer\'s field status before scoring starts, and "Unknown" for a missing tier, price, score and ranking', async () => {
    seedOneEvent();
    listEventTiersMock.mockResolvedValue({ data: { tiers: [] } });
    listEventParticipantsMock.mockResolvedValue({
      data: {
        participants: [
          fieldEntryFixture({
            id: 'sep-active',
            participantId: 'p-active',
            participant: participantFixture({ id: 'p-active', name: 'Active Golfer' }),
            isActive: true,
          }),
          fieldEntryFixture({
            id: 'sep-wd',
            participantId: 'p-wd',
            participant: participantFixture({ id: 'p-wd', name: 'Withdrawn Golfer' }),
            isActive: false,
            inactiveReason: 'WITHDRAWN',
          }),
          fieldEntryFixture({
            id: 'sep-inactive',
            participantId: 'p-inactive',
            participant: participantFixture({ id: 'p-inactive', name: 'Benched Golfer' }),
            isActive: false,
            inactiveReason: null,
          }),
        ],
      },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId(`root-admin-event-participants-${eventId}`));

    const activeRow = await screen.findByTestId('root-admin-event-participant-row-sep-active');
    expect(within(activeRow).getByText('Active')).toBeInTheDocument();
    // Ranking, odds, tier, short name and score are unknown; the price line reads "Price Unknown".
    expect(within(activeRow).getAllByText('Unknown')).toHaveLength(5);
    expect(within(activeRow).getByText('Price Unknown')).toBeInTheDocument();
    expect(within(activeRow).getByText('0 rounds, strokes Unknown')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('root-admin-event-participant-row-sep-wd')).getByText('Withdrawn'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('root-admin-event-participant-row-sep-inactive')).getByText('Inactive'),
    ).toBeInTheDocument();
  });

  it('shows the server\'s reason in the dialog when the event\'s field cannot be loaded', async () => {
    seedOneEvent();
    listEventTiersMock.mockResolvedValue({ data: { tiers: [] } });
    listEventParticipantsMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The field store is unavailable.'));
    renderPage();

    fireEvent.click(await screen.findByTestId(`root-admin-event-participants-${eventId}`));

    const modal = await screen.findByTestId('root-admin-event-participants-modal');
    expect(await within(modal).findByText('The field store is unavailable.')).toBeInTheDocument();
  });

  it('shows the server\'s reason in the dialog when the event\'s tiers cannot be loaded', async () => {
    seedOneEvent();
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    listEventTiersMock.mockResolvedValue(refusal('INTERNAL_ERROR', 'The tier store is unavailable.'));
    renderPage();

    fireEvent.click(await screen.findByTestId(`root-admin-event-participants-${eventId}`));

    const modal = await screen.findByTestId('root-admin-event-participants-modal');
    expect(await within(modal).findByText('The tier store is unavailable.')).toBeInTheDocument();
  });

  it('closes the participant dialog from its close button', async () => {
    seedOneEvent();
    listEventTiersMock.mockResolvedValue({ data: { tiers: [] } });
    listEventParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();

    fireEvent.click(await screen.findByTestId(`root-admin-event-participants-${eventId}`));
    const modal = await screen.findByTestId('root-admin-event-participants-modal');
    expect(await within(modal).findByText('No participants are currently loaded for this event.')).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'Close modal' }));

    await waitFor(() =>
      expect(screen.queryByTestId('root-admin-event-participants-modal')).not.toBeInTheDocument(),
    );
  });
});
