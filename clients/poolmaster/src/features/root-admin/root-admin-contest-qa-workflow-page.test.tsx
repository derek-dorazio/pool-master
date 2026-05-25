import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminContestQaWorkflowPage } from './root-admin-contest-qa-workflow-page';

const {
  adminListProvidersMock,
  adminRunContestQaWorkflowMock,
  listEventsMock,
} = vi.hoisted(() => ({
  adminListProvidersMock: vi.fn(),
  adminRunContestQaWorkflowMock: vi.fn(),
  listEventsMock: vi.fn(),
}));

bindApiMocks({
  adminListProviders: adminListProvidersMock,
  adminRunContestQaWorkflow: adminRunContestQaWorkflowMock,
  listEvents: listEventsMock,
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminContestQaWorkflowPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminContestQaWorkflowPage', () => {
  beforeEach(() => {
    adminListProvidersMock.mockReset();
    adminRunContestQaWorkflowMock.mockReset();
    listEventsMock.mockReset();

    adminListProvidersMock.mockResolvedValue({
      data: {
        items: [
          {
            providerId: 'mock-contest-feed',
            providerName: 'Mock contest feed',
            status: 'HEALTHY',
            sportsCovered: ['GOLF'],
          },
        ],
      },
    });
    listEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            id: 'event-1',
            externalId: 'golf-relative-weekend-20260528',
            sport: 'GOLF',
            name: 'Rolling QA Weekend Championship',
            venue: 'QA Links',
            location: 'Cincinnati, OH',
            status: 'SCHEDULED',
            startDate: '2026-05-28T12:00:00.000Z',
            endDate: '2026-05-31T22:00:00.000Z',
            releaseAt: '2026-05-14T12:00:00.000Z',
            fieldLocksAt: '2026-05-27T16:00:00.000Z',
            participantCount: 80,
            fieldLocked: false,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
          },
        ],
      },
    });
    adminRunContestQaWorkflowMock.mockResolvedValue({
      data: {
        workflowId: 'workflow-1',
        mode: 'DRIVE_EVENT_LIVE_TEST',
        sport: 'GOLF',
        eventId: 'golf-relative-weekend-20260528',
        mockEventState: 'live',
        submittedAt: '2026-05-25T17:45:00.000Z',
        steps: [
          {
            id: 'apply-event-state',
            label: 'Apply mock event state',
            status: 'SUBMITTED',
            feeds: ['EVENTPARTICIPANTS'],
            eventId: 'golf-relative-weekend-20260528',
            syncRunIds: ['sync-run-1'],
            summary: 'Submitted event detail hydration with mock state live.',
            warnings: [],
            nextActions: ['Wait for live-score sync to complete.'],
          },
          {
            id: 'sync-live-scores',
            label: 'Sync live scores',
            status: 'SUBMITTED',
            feeds: ['EVENTLIVESCORES'],
            eventId: 'golf-relative-weekend-20260528',
            syncRunIds: ['sync-run-2'],
            summary: 'Submitted event live scores for mock state live.',
            warnings: [],
            nextActions: ['Open contest standings after the sync completes.'],
          },
        ],
        eventCandidates: [],
        warnings: [],
        nextActions: ['Open contest standings after the sync completes.'],
      },
    });
  });

  it('pool-master-33l.8.10 submits a guided live-test workflow with event state', async () => {
    renderPage();

    expect(
      await screen.findByTestId('root-admin-contest-qa-workflow-page'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('root-admin-contest-qa-workflow-mode'), {
      target: { value: 'DRIVE_EVENT_LIVE_TEST' },
    });
    fireEvent.change(screen.getByTestId('root-admin-contest-qa-event-id'), {
      target: { value: 'golf-relative-weekend-20260528' },
    });
    fireEvent.change(screen.getByTestId('root-admin-contest-qa-mock-event-state'), {
      target: { value: 'live' },
    });

    fireEvent.click(screen.getByTestId('root-admin-contest-qa-run'));

    await waitFor(() => {
      expect(adminRunContestQaWorkflowMock).toHaveBeenCalledWith({
        body: {
          mode: 'DRIVE_EVENT_LIVE_TEST',
          sport: 'GOLF',
          eventId: 'golf-relative-weekend-20260528',
          mockEventState: 'live',
        },
      });
    });

    expect(
      await screen.findByTestId('root-admin-contest-qa-response'),
    ).toHaveTextContent('sync-live-scores');
  });
});
