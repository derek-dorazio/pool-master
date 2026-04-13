import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListLeaguesResponses } from '@/lib/api';
import { ManageLeagueModal } from './manage-league-modal';

const inactivateLeagueMock = vi.fn();
const deleteLeagueMock = vi.fn();

vi.mock('@/lib/api', () => ({
  inactivateLeague: (...args: unknown[]) => inactivateLeagueMock(...args),
  deleteLeague: (...args: unknown[]) => deleteLeagueMock(...args),
}));

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

const commissionerLeague: LeagueSummary = {
  id: 'league-1',
  leagueCode: 'BIGDAWGS',
  name: 'Big Dawgs',
  description: 'Neighborhood league',
  visibility: 'PRIVATE',
  isActive: true,
  memberCount: 4,
  activeContestCount: 1,
  role: 'COMMISSIONER',
};

describe('ManageLeagueModal', () => {
  afterEach(() => {
    inactivateLeagueMock.mockReset();
    deleteLeagueMock.mockReset();
  });

  it('opens on the lifecycle tab and inactivates the league', async () => {
    inactivateLeagueMock.mockResolvedValue({
      data: {
        league: {
          ...commissionerLeague,
          isActive: false,
        },
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ManageLeagueModal
          isOpen
          league={commissionerLeague}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId('manage-league-inactivate'));

    await waitFor(() =>
      expect(inactivateLeagueMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
      }),
    );
  });

  it('keeps delete disabled until the confirmation code matches', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ManageLeagueModal
          isOpen
          league={{
            ...commissionerLeague,
            isActive: false,
          }}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const deleteButton = screen.getByTestId('manage-league-delete-submit');
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByTestId('manage-league-delete-confirmation'), {
      target: { value: 'WRONGCODE' },
    });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByTestId('manage-league-delete-confirmation'), {
      target: { value: 'BIGDAWGS' },
    });

    await waitFor(() => expect(deleteButton).not.toBeDisabled());
  });

  it('deletes an inactive league and shows success state', async () => {
    deleteLeagueMock.mockResolvedValue({
      data: {
        success: true,
      },
    });

    const onDeleted = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ManageLeagueModal
          isOpen
          league={{
            ...commissionerLeague,
            isActive: false,
          }}
          onClose={vi.fn()}
          onDeleted={onDeleted}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByTestId('manage-league-delete-confirmation'), {
      target: { value: 'BIGDAWGS' },
    });
    fireEvent.click(screen.getByTestId('manage-league-delete-submit'));

    await waitFor(() =>
      expect(deleteLeagueMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: { leagueCode: 'BIGDAWGS' },
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('manage-league-delete-success')).toBeVisible(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(onDeleted).toHaveBeenCalled();
  });
});
