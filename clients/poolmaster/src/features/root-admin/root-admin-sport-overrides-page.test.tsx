import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportOverridesPage } from './root-admin-sport-overrides-page';

const {
  getIngestionScheduleMock,
  resetSportIngestionOverrideMock,
  setSportIngestionOverrideMock,
} = vi.hoisted(() => ({
  getIngestionScheduleMock: vi.fn(),
  resetSportIngestionOverrideMock: vi.fn(),
  setSportIngestionOverrideMock: vi.fn(),
}));

bindApiMocks({
  getIngestionSchedule: getIngestionScheduleMock,
  resetSportIngestionOverride: resetSportIngestionOverrideMock,
  setSportIngestionOverride: setSportIngestionOverrideMock,
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
    getIngestionScheduleMock.mockReset();
    resetSportIngestionOverrideMock.mockReset();
    setSportIngestionOverrideMock.mockReset();

    const response = {
      data: {
        healthCheck: { enabled: true, intervalMinutes: 5 },
        eventSchedule: { enabled: true, intervalMinutes: 1440, lookaheadDays: 365 },
        eventParticipants: {
          enabled: true,
          intervalMinutes: 360,
          lookaheadDays: 14,
        },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
        eventResults: { enabled: true, intervalMinutes: 30 },
        perSportOverrides: {},
      },
    };

    getIngestionScheduleMock.mockResolvedValue(response);
    resetSportIngestionOverrideMock.mockResolvedValue(response);
    setSportIngestionOverrideMock.mockResolvedValue(response);
  });

  it('pool-master-7wj.7 shows loading state while sport override configuration loads', async () => {
    getIngestionScheduleMock.mockReturnValue(new Promise(() => undefined));

    renderPage();

    const loading = await screen.findByTestId('root-admin-sport-overrides-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('root-admin-sport-overrides-save')).not.toBeInTheDocument();
  });

  it('pool-master-7wj.7 shows error state when sport override configuration fails', async () => {
    getIngestionScheduleMock.mockRejectedValue(new Error('Schedule unavailable'));

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
      expect(setSportIngestionOverrideMock).toHaveBeenCalledWith({
        path: { sport: 'GOLF' },
        body: {
          healthCheck: { enabled: true },
          eventSchedule: { enabled: true },
          eventParticipants: { enabled: true },
          eventLiveScores: { enabled: false },
          eventResults: { enabled: true },
        },
      }),
    );
  });
});
