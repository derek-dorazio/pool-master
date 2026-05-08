import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminPollIntervalsPage } from './root-admin-poll-intervals-page';

const {
  adminGetPollIntervalsMock,
  adminResetPollIntervalsMock,
  adminUpdatePollIntervalsMock,
} = vi.hoisted(() => ({
  adminGetPollIntervalsMock: vi.fn(),
  adminResetPollIntervalsMock: vi.fn(),
  adminUpdatePollIntervalsMock: vi.fn(),
}));

bindApiMocks({
  adminGetPollIntervals: adminGetPollIntervalsMock,
  adminResetPollIntervals: adminResetPollIntervalsMock,
  adminUpdatePollIntervals: adminUpdatePollIntervalsMock,
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
        <RootAdminPollIntervalsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminPollIntervalsPage', () => {
  beforeEach(() => {
    adminGetPollIntervalsMock.mockReset();
    adminResetPollIntervalsMock.mockReset();
    adminUpdatePollIntervalsMock.mockReset();

    const response = {
      data: {
        standings: 10000,
        draft: 10000,
        contestStatus: 30000,
        notifications: 30000,
        default: 30000,
      },
    };

    adminGetPollIntervalsMock.mockResolvedValue(response);
    adminUpdatePollIntervalsMock.mockResolvedValue(response);
    adminResetPollIntervalsMock.mockResolvedValue(response);
  });

  it('renders and saves the poll interval configuration', async () => {
    renderPage();

    const standingsInput = await screen.findByTestId('root-admin-poll-page-standings');
    fireEvent.change(standingsInput, {
      target: { value: '15000' },
    });
    fireEvent.click(screen.getByTestId('root-admin-poll-page-save'));

    await waitFor(() =>
      expect(adminUpdatePollIntervalsMock).toHaveBeenCalledWith({
        body: {
          standings: 15000,
          draft: 10000,
          contestStatus: 30000,
          notifications: 30000,
          default: 30000,
        },
      }),
    );
    expect(screen.getByRole('link', { name: 'Back to Sync Configuration' })).toHaveAttribute(
      'href',
      '/manage/sync-config',
    );
  });
});
