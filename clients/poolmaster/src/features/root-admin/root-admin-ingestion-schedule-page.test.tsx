import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminIngestionSchedulePage } from './root-admin-ingestion-schedule-page';

const {
  getIngestionScheduleMock,
  resetIngestionScheduleMock,
  updateIngestionScheduleMock,
} = vi.hoisted(() => ({
  getIngestionScheduleMock: vi.fn(),
  resetIngestionScheduleMock: vi.fn(),
  updateIngestionScheduleMock: vi.fn(),
}));

bindApiMocks({
  getIngestionSchedule: getIngestionScheduleMock,
  resetIngestionSchedule: resetIngestionScheduleMock,
  updateIngestionSchedule: updateIngestionScheduleMock,
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
        <RootAdminIngestionSchedulePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminIngestionSchedulePage', () => {
  beforeEach(() => {
    getIngestionScheduleMock.mockReset();
    resetIngestionScheduleMock.mockReset();
    updateIngestionScheduleMock.mockReset();

    const response = {
      data: {
        healthCheck: { enabled: true, intervalMinutes: 5 },
        eventSchedule: { enabled: true, intervalMinutes: 1440, lookaheadDays: 365 },
        eventParticipants: {
          enabled: true,
          intervalMinutes: 360,
          lookaheadDays: 14,
        },
        participantRankings: { enabled: true, intervalMinutes: 1440 },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
        eventResults: { enabled: true, intervalMinutes: 30 },
        perSportOverrides: {},
      },
    };

    getIngestionScheduleMock.mockResolvedValue(response);
    resetIngestionScheduleMock.mockResolvedValue(response);
    updateIngestionScheduleMock.mockResolvedValue(response);
  });

  it('pool-master-rop.68.1.5 renders and saves the global ingestion schedule with separate schedule and field windows', async () => {
    renderPage();

    const liveScoresInput = await screen.findByTestId(
      'root-admin-ingestion-page-eventLiveScores-intervalSeconds',
    );
    fireEvent.change(liveScoresInput, {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByTestId('root-admin-ingestion-page-save'));

    await waitFor(() =>
      expect(updateIngestionScheduleMock).toHaveBeenCalledWith({
        body: {
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 1440, lookaheadDays: 365 },
          eventParticipants: {
            enabled: true,
            intervalMinutes: 360,
            lookaheadDays: 14,
          },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: true, intervalSeconds: 45 },
          eventResults: { enabled: true, intervalMinutes: 30 },
        },
      }),
    );
  });
});
