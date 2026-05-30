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

  it('pool-master-7wj.7 shows loading state while sport override configuration loads', async () => {
    adminGetIngestionScheduleMock.mockReturnValue(new Promise(() => undefined));

    renderPage();

    const loading = await screen.findByTestId('root-admin-sport-overrides-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('root-admin-sport-overrides-save')).not.toBeInTheDocument();
  });

  it('pool-master-7wj.7 shows error state when sport override configuration fails', async () => {
    adminGetIngestionScheduleMock.mockRejectedValue(new Error('Schedule unavailable'));

    renderPage();

    const error = await screen.findByTestId('root-admin-sport-overrides-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveTextContent('Schedule unavailable');
  });

  it('pool-master-rop.68.1.2 renders and saves a sport-specific override without participant lead days', async () => {
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
