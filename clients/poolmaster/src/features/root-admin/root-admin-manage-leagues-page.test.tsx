import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootAdminManageLeaguesPage } from './root-admin-manage-leagues-page';

const {
  adminListLeaguesMock,
  mockLogger,
} = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);

  return {
    adminListLeaguesMock: vi.fn(),
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  adminListLeagues: (...args: unknown[]) => adminListLeaguesMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

function seedLeagues() {
  adminListLeaguesMock.mockResolvedValue({
    data: {
      leagues: [
        {
          id: 'league-active-1',
          leagueCode: 'ACTIVE01',
          name: 'Alpha League',
          description: 'Primary active league',
          isActive: true,
          iconKey: 'TROPHY',
          memberCount: 12,
          activeContestCount: 3,
          createdAt: '2026-04-10T12:00:00.000Z',
        },
        {
          id: 'league-inactive-1',
          leagueCode: 'INACT001',
          name: 'Archive League',
          description: 'Already inactive',
          isActive: false,
          iconKey: 'GOLF_FLAG',
          memberCount: 8,
          activeContestCount: 0,
          createdAt: '2026-03-01T12:00:00.000Z',
        },
      ],
    },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminManageLeaguesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminManageLeaguesPage', () => {
  afterEach(() => {
    adminListLeaguesMock.mockReset();
    mockLogger.info.mockReset();
  });

  it('pool-master-dxd.35 renders a row per league without duplicate admin header copy', async () => {
    seedLeagues();

    renderPage();

    expect(screen.queryByText('Back to Manage')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Filter leagues by column/),
    ).not.toBeInTheDocument();
    const activeRow = await screen.findByTestId(
      'root-admin-manage-leagues-link-league-active-1',
    );
    expect(activeRow).toHaveTextContent('Alpha League');
    expect(activeRow).toHaveTextContent('Active');
    expect(activeRow).toHaveTextContent('ACTIVE01');
    expect(screen.getByRole('link', { name: /Alpha League/ })).toHaveAttribute(
      'href',
      '/league/ACTIVE01',
    );

    const inactiveRow = screen.getByTestId(
      'root-admin-manage-leagues-link-league-inactive-1',
    );
    expect(inactiveRow).toHaveTextContent('Inactive');
    expect(screen.getByRole('link', { name: /Archive League/ })).toHaveAttribute(
      'href',
      '/league/INACT001',
    );
  });

  it('does not render any lifecycle action controls on the admin list', async () => {
    seedLeagues();

    renderPage();

    await screen.findByTestId('root-admin-manage-leagues-link-league-active-1');

    expect(
      screen.queryByTestId('root-admin-league-inactivate-league-active-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('root-admin-league-delete-league-inactive-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('root-admin-league-delete-code-league-inactive-1'),
    ).not.toBeInTheDocument();
  });

  it('pool-master-xjj filters leagues client-side through grid column filters', async () => {
    seedLeagues();

    renderPage();

    await waitFor(() =>
      expect(adminListLeaguesMock).toHaveBeenLastCalledWith({
        query: {},
      }),
    );
    await screen.findByTestId('root-admin-manage-leagues-link-league-active-1');

    expect(
      screen.queryByTestId('root-admin-manage-leagues-search'),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('admin-grid-filter-name'), {
      target: { value: 'Archive' },
    });

    expect(
      screen.queryByTestId('root-admin-manage-leagues-link-league-active-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('root-admin-manage-leagues-link-league-inactive-1'),
    ).toBeInTheDocument();
    expect(adminListLeaguesMock).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when no leagues match the current filters', async () => {
    adminListLeaguesMock.mockResolvedValue({ data: { leagues: [] } });

    renderPage();

    expect(await screen.findByText('No leagues matched the current filters.')).toBeInTheDocument();
  });

  it('renders the error state when the admin list call fails', async () => {
    adminListLeaguesMock.mockResolvedValue({
      data: null,
      error: { message: 'Boom' },
    });

    renderPage();

    expect(await screen.findByText('Boom')).toBeInTheDocument();
  });
});
