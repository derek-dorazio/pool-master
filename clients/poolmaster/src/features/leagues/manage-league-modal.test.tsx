import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManageLeagueModal } from './manage-league-modal';
import {
  apiSuccess,
  buildLeagueDetail,
  buildLeagueSummary,
  deleteLeagueData,
  getLeagueData,
  inactivateLeagueData,
  updateLeagueDetailsData,
  updateLeagueIconData,
  type LeagueSummary,
} from './test/fixtures';

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

function LeaguesQueryProbe({ queryFn }: { queryFn: () => Promise<LeagueSummary[]> }) {
  const leaguesQuery = useQuery({
    queryKey: ['poolmaster', 'leagues'],
    queryFn,
    retry: false,
  });

  if (leaguesQuery.isLoading) {
    return <div data-testid="league-list-state">loading</div>;
  }

  if (leaguesQuery.isError) {
    return <div data-testid="league-list-state">error</div>;
  }

  const leagues = leaguesQuery.data ?? [];

  return (
    <div data-testid="league-list-state">
      {leagues
        .map((league) => `${league.leagueCode}:${league.iconKey}`)
        .join(',') || 'empty'}
    </div>
  );
}

const commissionerLeague = buildLeagueSummary({
  description: 'Neighborhood league',
  memberCount: 4,
  createdAt: '2026-04-15T10:00:00.000Z',
});

describe('pool-master-rop.23: ManageLeagueModal generated DTO fixtures', () => {
  afterEach(() => {
    getLeagueMock.mockReset();
    inactivateLeagueMock.mockReset();
    deleteLeagueMock.mockReset();
    updateLeagueDetailsMock.mockReset();
    updateLeagueIconMock.mockReset();
  });

  it('pool-master-rop.23: opens on the lifecycle tab and inactivates the league', async () => {
    getLeagueMock.mockResolvedValue(apiSuccess(getLeagueData(buildLeagueDetail(commissionerLeague))));
    inactivateLeagueMock.mockResolvedValue(apiSuccess(inactivateLeagueData(buildLeagueDetail({
      ...commissionerLeague,
      isActive: false,
    }))));

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

  it('pool-master-rop.23: keeps delete disabled until the confirmation code matches', async () => {
    getLeagueMock.mockResolvedValue(apiSuccess(getLeagueData(buildLeagueDetail(commissionerLeague))));
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

  it('pool-master-rop.23: deletes an inactive league and shows success state', async () => {
    getLeagueMock.mockResolvedValue(apiSuccess(getLeagueData(buildLeagueDetail(commissionerLeague))));
    deleteLeagueMock.mockResolvedValue(apiSuccess(deleteLeagueData()));

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

  it('pool-master-rop.23: updates league details from the details tab', async () => {
    getLeagueMock.mockResolvedValue(apiSuccess(getLeagueData(buildLeagueDetail(commissionerLeague))));
    updateLeagueDetailsMock.mockResolvedValue(apiSuccess(updateLeagueDetailsData(buildLeagueDetail({
      ...commissionerLeague,
      name: 'Edited Dawgs',
      description: 'Updated description',
    }))));

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
    expect(queryClient.getQueryData(['poolmaster', 'league', 'BIGDAWGS'])).toMatchObject({
      name: 'Edited Dawgs',
      description: 'Updated description',
    });
    expect(queryClient.getQueryData(['poolmaster', 'leagues'])).toEqual([
      expect.objectContaining({
        id: 'league-1',
        name: 'Edited Dawgs',
      }),
    ]);
  });

  it('pool-master-rop.23: updates the league icon by syncing the shell league list without refetching it', async () => {
    getLeagueMock.mockResolvedValue(apiSuccess(getLeagueData(buildLeagueDetail(commissionerLeague))));
    updateLeagueIconMock.mockResolvedValue(apiSuccess(updateLeagueIconData(buildLeagueDetail({
      ...commissionerLeague,
      iconKey: 'GOLF_BALL',
    }))));
    const leaguesQueryFn = vi
      .fn<() => Promise<LeagueSummary[]>>()
      .mockResolvedValue([commissionerLeague]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <LeaguesQueryProbe queryFn={leaguesQueryFn} />
        <ManageLeagueModal
          isOpen
          league={commissionerLeague}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('league-list-state')).toHaveTextContent('BIGDAWGS:TROPHY'),
    );

    fireEvent.click(screen.getByRole('button', { name: /Icon/ }));
    fireEvent.click(screen.getByTestId('manage-league-icon-GOLF_BALL'));
    fireEvent.click(screen.getByTestId('manage-league-save-icon'));

    await waitFor(() =>
      expect(updateLeagueIconMock).toHaveBeenCalledWith({
        path: { id: 'league-1' },
        body: {
          iconKey: 'GOLF_BALL',
        },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('league-list-state')).toHaveTextContent('BIGDAWGS:GOLF_BALL'));
    expect(leaguesQueryFn).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['poolmaster', 'league', 'BIGDAWGS'])).toMatchObject({
      iconKey: 'GOLF_BALL',
    });
    expect(queryClient.getQueryData(['poolmaster', 'leagues'])).toEqual([
      expect.objectContaining({
        id: 'league-1',
        iconKey: 'GOLF_BALL',
      }),
    ]);
  });

  it('pool-master-rop.23: shows details as read-only when the league is inactive', async () => {
    getLeagueMock.mockResolvedValue(apiSuccess(getLeagueData(buildLeagueDetail({
      ...commissionerLeague,
      isActive: false,
    }))));

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

  it('pool-master-rop.23: updates league icon from the curated catalog', async () => {
    getLeagueMock.mockResolvedValue(apiSuccess(getLeagueData(buildLeagueDetail(commissionerLeague))));
    updateLeagueIconMock.mockResolvedValue(apiSuccess(updateLeagueIconData(buildLeagueDetail({
      ...commissionerLeague,
      iconKey: 'SOCCER_BALL',
    }))));

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
