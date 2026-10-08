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
        eventParticipants: {
          enabled: true,
          intervalMinutes: 360,
          lookaheadDays: 14,
        },
        eventLiveScores: { enabled: true, intervalSeconds: 30 },
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
          eventParticipants: {
            enabled: true,
            intervalMinutes: 360,
            lookaheadDays: 14,
          },
          eventLiveScores: { enabled: true, intervalSeconds: 45 },
        },
      }),
    );
  });
  it('shows the server\'s reason when saving the schedule is refused, instead of silently keeping the edit', async () => {
    updateIngestionScheduleMock.mockResolvedValue({
      error: { error: { code: 'VALIDATION_ERROR', message: 'intervalSeconds must be at least 10.' } },
      response: { status: 400 },
    });
    renderPage();

    fireEvent.change(
      await screen.findByTestId('root-admin-ingestion-page-eventLiveScores-intervalSeconds'),
      { target: { value: '5' } },
    );
    fireEvent.click(screen.getByTestId('root-admin-ingestion-page-save'));

    expect(await screen.findByText('intervalSeconds must be at least 10.')).toBeInTheDocument();
  });

  it('shows the server\'s reason when resetting the schedule is refused', async () => {
    resetIngestionScheduleMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'The schedule store is unavailable.' } },
      response: { status: 500 },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Reset ingestion schedule' }));

    expect(await screen.findByText('The schedule store is unavailable.')).toBeInTheDocument();
  });
});

describe('RootAdminIngestionSchedulePage load failure, toggles, blank values and pending reset', () => {
  beforeEach(() => {
    getIngestionScheduleMock.mockReset();
    resetIngestionScheduleMock.mockReset();
    updateIngestionScheduleMock.mockReset();
  });

  const schedule = {
    data: {
      scheduledSports: ['GOLF'],
      healthCheck: { enabled: true, intervalMinutes: 5 },
      eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
      eventLiveScores: { enabled: true, intervalSeconds: 30 },
      perSportOverrides: {},
    },
  };

  it('shows the server\'s reason in place of the editor when the schedule cannot be loaded', async () => {
    getIngestionScheduleMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'The schedule store is unavailable.' } },
      response: { status: 500 },
    });
    renderPage();

    expect(await screen.findByText('The schedule store is unavailable.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-ingestion-page-save')).not.toBeInTheDocument();
  });

  it('saves a policy switched off with its checkbox as enabled false', async () => {
    getIngestionScheduleMock.mockResolvedValue(schedule);
    updateIngestionScheduleMock.mockResolvedValue(schedule);
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-ingestion-page-healthCheck-enabled'));
    fireEvent.click(screen.getByTestId('root-admin-ingestion-page-save'));

    await waitFor(() => expect(updateIngestionScheduleMock).toHaveBeenCalledTimes(1));
    expect((updateIngestionScheduleMock.mock.calls[0][0] as { body: Record<string, unknown> }).body)
      .toMatchObject({ healthCheck: { enabled: false, intervalMinutes: 5 } });
  });

  it('leaves an interval or look-ahead the server does not send blank rather than showing 0', async () => {
    getIngestionScheduleMock.mockResolvedValue({
      data: {
        ...schedule.data,
        eventParticipants: { enabled: true },
        eventLiveScores: { enabled: false },
      },
    });
    renderPage();

    expect(await screen.findByTestId('root-admin-ingestion-page-eventParticipants-intervalMinutes')).toHaveValue(null);
    expect(screen.getByTestId('root-admin-ingestion-page-eventParticipants-lookaheadDays')).toHaveValue(null);
    expect(screen.getByTestId('root-admin-ingestion-page-eventLiveScores-intervalSeconds')).toHaveValue(null);
  });

  it('reads "Resetting..." and disables the reset button while the reset is in flight', async () => {
    getIngestionScheduleMock.mockResolvedValue(schedule);
    resetIngestionScheduleMock.mockReturnValue(new Promise(() => undefined));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Reset ingestion schedule' }));

    const pending = await screen.findByRole('button', { name: 'Resetting...' });
    expect(pending).toBeDisabled();
  });
});
