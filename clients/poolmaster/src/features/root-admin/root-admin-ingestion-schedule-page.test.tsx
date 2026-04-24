import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootAdminIngestionSchedulePage } from './root-admin-ingestion-schedule-page';

const {
  adminGetIngestionScheduleMock,
  adminResetIngestionScheduleMock,
  adminUpdateIngestionScheduleMock,
} = vi.hoisted(() => ({
  adminGetIngestionScheduleMock: vi.fn(),
  adminResetIngestionScheduleMock: vi.fn(),
  adminUpdateIngestionScheduleMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  adminGetIngestionSchedule: (...args: unknown[]) =>
    adminGetIngestionScheduleMock(...args),
  adminResetIngestionSchedule: (...args: unknown[]) =>
    adminResetIngestionScheduleMock(...args),
  adminUpdateIngestionSchedule: (...args: unknown[]) =>
    adminUpdateIngestionScheduleMock(...args),
}));

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
    adminGetIngestionScheduleMock.mockReset();
    adminResetIngestionScheduleMock.mockReset();
    adminUpdateIngestionScheduleMock.mockReset();

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
    adminResetIngestionScheduleMock.mockResolvedValue(response);
    adminUpdateIngestionScheduleMock.mockResolvedValue(response);
  });

  it('renders and saves the global ingestion schedule', async () => {
    renderPage();

    const liveScoresInput = await screen.findByTestId(
      'root-admin-ingestion-page-eventLiveScores-intervalSeconds',
    );
    fireEvent.change(liveScoresInput, {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByTestId('root-admin-ingestion-page-save'));

    await waitFor(() =>
      expect(adminUpdateIngestionScheduleMock).toHaveBeenCalledWith({
        body: {
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
          eventParticipants: {
            enabled: true,
            intervalMinutes: 720,
            leadDaysBeforeStart: 7,
          },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: true, intervalSeconds: 45 },
          eventResults: { enabled: true, intervalMinutes: 30 },
        },
      }),
    );
  });
});
