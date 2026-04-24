import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListLeaguesResponses } from '@/lib/api';
import { ManageLeagueModal } from './manage-league-modal';

const inactivateLeagueMock = vi.fn();
const deleteLeagueMock = vi.fn();
const getLeagueMock = vi.fn();
const updateLeagueDetailsMock = vi.fn();
const updateLeagueIconMock = vi.fn();

vi.mock('@/lib/api', () => ({
  getLeague: (...args: unknown[]) => getLeagueMock(...args),
  inactivateLeague: (...args: unknown[]) => inactivateLeagueMock(...args),
  deleteLeague: (...args: unknown[]) => deleteLeagueMock(...args),
  updateLeagueDetails: (...args: unknown[]) => updateLeagueDetailsMock(...args),
  updateLeagueIcon: (...args: unknown[]) => updateLeagueIconMock(...args),
}));

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

const commissionerLeague: LeagueSummary = {
  id: 'league-1',
  leagueCode: 'BIGDAWGS',
  name: 'Big Dawgs',
  description: 'Neighborhood league',
  isActive: true,
  iconKey: 'TROPHY',
  memberCount: 4,
  activeContestCount: 1,
  memberType: 'COMMISSIONER',
  leagueRelationship: {
    leagueMember: true,
    commissioner: true,
  },
  isRootAdmin: false,
  createdAt: '2026-04-15T10:00:00.000Z',
};

describe('ManageLeagueModal', () => {
  afterEach(() => {
    getLeagueMock.mockReset();
    inactivateLeagueMock.mockReset();
    deleteLeagueMock.mockReset();
    updateLeagueDetailsMock.mockReset();
    updateLeagueIconMock.mockReset();
  });

  it('opens on the lifecycle tab and inactivates the league', async () => {
    getLeagueMock.mockResolvedValue({
      data: {
        league: {
          ...commissionerLeague,
          iconKey: 'TROPHY',
          joinPolicy: 'COMMISSIONER_ONLY',
        },
      },
    });
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
    getLeagueMock.mockResolvedValue({
      data: {
        league: {
          ...commissionerLeague,
          iconKey: 'TROPHY',
          joinPolicy: 'COMMISSIONER_ONLY',
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
    getLeagueMock.mockResolvedValue({
      data: {
        league: {
          ...commissionerLeague,
          iconKey: 'TROPHY',
          joinPolicy: 'COMMISSIONER_ONLY',
        },
      },
    });
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

  it('updates league details from the details tab', async () => {
    getLeagueMock.mockResolvedValue({
      data: {
        league: {
          ...commissionerLeague,
          iconKey: 'TROPHY',
          joinPolicy: 'COMMISSIONER_ONLY',
        },
      },
    });
    updateLeagueDetailsMock.mockResolvedValue({
      data: {
        league: {
          ...commissionerLeague,
          iconKey: 'TROPHY',
          name: 'Edited Dawgs',
          description: 'Updated description',
          joinPolicy: 'COMMISSIONER_ONLY',
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

    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    fireEvent.change(screen.getByTestId('manage-league-name'), {
      target: { value: 'Edited Dawgs' },
    });
    fireEvent.change(screen.getByTestId('manage-league-description'), {
      target: { value: 'Updated description' },
    });
    fireEvent.click(screen.getByTestId('manage-league-save-details'));

    await waitFor(() =>
      expect(updateLeagueDetailsMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: {
          name: 'Edited Dawgs',
          description: 'Updated description',
        },
      }),
    );
  });

  it('shows details as read-only when the league is inactive', async () => {
    getLeagueMock.mockResolvedValue({
      data: {
        league: {
          ...commissionerLeague,
          isActive: false,
          iconKey: 'TROPHY',
          joinPolicy: 'COMMISSIONER_ONLY',
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
          league={{
            ...commissionerLeague,
            isActive: false,
          }}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Details/ }));

    expect(screen.getByTestId('manage-league-name')).toBeDisabled();
    expect(screen.getByTestId('manage-league-description')).toBeDisabled();
    expect(screen.getByTestId('manage-league-save-details')).toBeDisabled();
  });

  it('updates league icon from the curated catalog', async () => {
    getLeagueMock.mockResolvedValue({
      data: {
        league: {
          ...commissionerLeague,
          iconKey: 'TROPHY',
          joinPolicy: 'COMMISSIONER_ONLY',
        },
      },
    });
    updateLeagueIconMock.mockResolvedValue({
      data: {
        league: {
          ...commissionerLeague,
          iconKey: 'SOCCER_BALL',
          joinPolicy: 'COMMISSIONER_ONLY',
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

    fireEvent.click(screen.getByRole('button', { name: /Icon/ }));
    fireEvent.click(screen.getByTestId('manage-league-icon-SOCCER_BALL'));
    fireEvent.click(screen.getByTestId('manage-league-save-icon'));

    await waitFor(() =>
      expect(updateLeagueIconMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: {
          iconKey: 'SOCCER_BALL',
        },
      }),
    );
  });
});
