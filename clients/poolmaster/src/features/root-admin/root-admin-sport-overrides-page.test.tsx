import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportOverridesPage } from './root-admin-sport-overrides-page';

const {
  adminGetIngestionScheduleMock,
  adminResetSportIngestionOverrideMock,
  adminSetSportIngestionOverrideMock,
} = vi.hoisted(() => ({
  adminGetIngestionScheduleMock: vi.fn(),
  adminResetSportIngestionOverrideMock: vi.fn(),
  adminSetSportIngestionOverrideMock: vi.fn(),
}));

bindApiMocks({
  adminGetIngestionSchedule: adminGetIngestionScheduleMock,
  adminResetSportIngestionOverride: adminResetSportIngestionOverrideMock,
  adminSetSportIngestionOverride: adminSetSportIngestionOverrideMock,
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
        <RootAdminSportOverridesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminSportOverridesPage', () => {
  beforeEach(() => {
    adminGetIngestionScheduleMock.mockReset();
    adminResetSportIngestionOverrideMock.mockReset();
    adminSetSportIngestionOverrideMock.mockReset();

    const response = {
      data: {
        healthCheck: { enabled: true, intervalMinutes: 5 },
        eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
        eventParticipants: {
          enabled: true,
          intervalMinutes: 720,
          leadDaysBeforeStart: 7,
        },
        participantRankings: { enabled: true, intervalMinutes: 1440 },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
        eventResults: { enabled: true, intervalMinutes: 30 },
        perSportOverrides: {},
      },
    };

    adminGetIngestionScheduleMock.mockResolvedValue(response);
    adminResetSportIngestionOverrideMock.mockResolvedValue(response);
    adminSetSportIngestionOverrideMock.mockResolvedValue(response);
  });

  it('renders and saves a sport-specific override', async () => {
    renderPage();

    const liveScoresToggle = await screen.findByTestId(
      'root-admin-sport-overrides-eventLiveScores',
    );
    fireEvent.click(liveScoresToggle);
    fireEvent.click(screen.getByTestId('root-admin-sport-overrides-save'));

    await waitFor(() =>
      expect(adminSetSportIngestionOverrideMock).toHaveBeenCalledWith({
        path: { sport: 'GOLF' },
        body: {
          healthCheck: { enabled: true },
          eventSchedule: { enabled: true },
          eventParticipants: { enabled: true },
          participantRankings: { enabled: true },
          eventLiveScores: { enabled: false },
          eventResults: { enabled: true },
        },
      }),
    );
  });
});
