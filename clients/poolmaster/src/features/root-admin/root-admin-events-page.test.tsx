import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminEventsPage } from './root-admin-events-page';

const { adminListEventParticipantsMock, adminListEventsMock, mockLogger } = vi.hoisted(() => {
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
    adminListEventParticipantsMock: vi.fn(),
    adminListEventsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  adminListEventParticipants: adminListEventParticipantsMock,
  adminListEvents: adminListEventsMock,
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
    adminListEventParticipantsMock.mockReset();
    adminListEventsMock.mockReset();
    mockLogger.info.mockReset();
  });

  it('pool-master-33l.12 renders current persisted event state separately from sync-run history', async () => {
    adminListEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            externalId: 'golf-relative-weekend-20260507',
            providerId: 'mock-contest-feed',
            sport: 'GOLF',
            name: 'Rolling Weekend Invitational',
            venue: 'Mock Golf Club',
            location: 'Augusta, GA',
            status: 'SCHEDULED',
            startDate: '2026-05-07T12:00:00.000Z',
            endDate: '2026-05-10T22:00:00.000Z',
            releaseAt: '2026-04-23T12:00:00.000Z',
            fieldLocksAt: '2026-05-06T16:00:00.000Z',
            fieldLocked: false,
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

    await waitFor(() =>
      expect(adminListEventsMock).toHaveBeenLastCalledWith({
        query: { limit: 250 },
      }),
    );
  });

  it('pool-master-33l.12 opens a participant grid modal for the selected current-state event', async () => {
    const eventId = '11111111-1111-4111-8111-111111111111';
    adminListEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: eventId,
            externalId: 'golf-relative-weekend-20260507',
            providerId: 'mock-contest-feed',
            sport: 'GOLF',
            name: 'Rolling Weekend Invitational',
            status: 'IN_PROGRESS',
            startDate: '2026-05-07T12:00:00.000Z',
            releaseAt: '2026-04-23T12:00:00.000Z',
            fieldLocksAt: '2026-05-06T16:00:00.000Z',
            fieldLocked: true,
            loadedParticipantCount: 1,
            readinessStatus: 'FIELD_LOCKED',
            readinessReasons: ['FIELD_LOCKED'],
            contestEligible: false,
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T11:00:00.000Z',
          },
        ],
      },
    });
    adminListEventParticipantsMock.mockResolvedValue({
      data: {
        event: {
          id: eventId,
          externalId: 'golf-relative-weekend-20260507',
          providerId: 'mock-contest-feed',
          sport: 'GOLF',
          name: 'Rolling Weekend Invitational',
          status: 'IN_PROGRESS',
          startDate: '2026-05-07T12:00:00.000Z',
          releaseAt: '2026-04-23T12:00:00.000Z',
          fieldLocksAt: '2026-05-06T16:00:00.000Z',
          fieldLocked: true,
          loadedParticipantCount: 1,
          readinessStatus: 'FIELD_LOCKED',
          readinessReasons: ['FIELD_LOCKED'],
          contestEligible: false,
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T11:00:00.000Z',
        },
        participants: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            sportEventId: eventId,
            participantId: '33333333-3333-4333-8333-333333333333',
            participantName: 'Avery Driver',
            shortName: 'A. Driver',
            nationality: 'US',
            status: 'ACTIVE',
            worldRanking: 3,
            oddsToWin: 12.5,
            valuationPrice: 19,
            valuationTier: 'A',
            valuationOrderIndex: 1,
            roundCount: 2,
            totalStrokes: 141,
            scoreToPar: -3,
            golfRounds: [
              {
                round: 1,
                strokes: 70,
                scoreToPar: -2,
                status: 'COMPLETE',
                completedAt: '2026-05-07T21:00:00.000Z',
              },
            ],
            updatedAt: '2026-05-08T22:00:00.000Z',
          },
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
    expect(adminListEventParticipantsMock).toHaveBeenLastCalledWith({
      path: { eventId },
    });
  });
});
