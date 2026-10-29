import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';
import { RootAdminManageLeaguesPage } from './root-admin-manage-leagues-page';

const {
  extendRunningPlanRenewalsMock,
  listLeaguesMock,
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
    extendRunningPlanRenewalsMock: vi.fn(),
    listLeaguesMock: vi.fn(),
    mockLogger,
  };
});

bindApiMocks({
  extendRunningPlanRenewals: extendRunningPlanRenewalsMock,
  listLeagues: listLeaguesMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function seedLeagues() {
  listLeaguesMock.mockResolvedValue({
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
          planEntitlements: buildPlanEntitlements(),
          planRenewsAt: '2027-04-24T12:00:00.000Z',
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
          planEntitlements: buildPlanEntitlements({ plan: 'FREE' }),
          planRenewsAt: '2027-03-01T12:00:00.000Z',
        },
      ],
      // #202 (A8) — the viewer's own memberships among the returned leagues. Legitimately
      // empty for a root admin listing leagues they do not belong to; the page shows the
      // leagues, not their relationship to them.
      memberships: [],
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

/** Types into the page's search box; the page asks the server once the debounce settles. */
function searchFor(term: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a league' }), {
    target: { value: term },
  });
}

describe('RootAdminManageLeaguesPage', () => {
  afterEach(() => {
    extendRunningPlanRenewalsMock.mockReset();
    listLeaguesMock.mockReset();
    mockLogger.info.mockReset();
  });

  it('pool-master-dxd.35 renders a row per league without duplicate admin header copy', async () => {
    seedLeagues();

    renderPage();
    searchFor('League');

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

  it('shows each league\'s plan in its own column', async () => {
    seedLeagues();

    renderPage();
    searchFor('League');

    expect(await screen.findByTestId('root-admin-manage-leagues-link-league-active-1')).toHaveTextContent('Platinum');
    expect(screen.getByRole('columnheader', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-manage-leagues-link-league-inactive-1')).toHaveTextContent('Free');
  });

  it('shows when each league\'s Premium preview period ends in its own column', async () => {
    seedLeagues();

    renderPage();
    searchFor('League');

    expect(await screen.findByTestId('root-admin-manage-leagues-link-league-active-1'))
      .toHaveTextContent(new Date('2027-04-24T12:00:00.000Z').toLocaleDateString());
    expect(screen.getByRole('columnheader', { name: 'Preview ends' })).toBeInTheDocument();
  });

  it('extends every running gift by the chosen months, says how many leagues moved to which date, and reloads the list', async () => {
    seedLeagues();
    extendRunningPlanRenewalsMock.mockResolvedValue({ data: { extendedCount: 2, renewsAt: '2027-10-24T12:00:00.000Z' } });

    renderPage();
    searchFor('League');

    await screen.findByTestId('root-admin-manage-leagues-link-league-active-1');
    fireEvent.change(screen.getByTestId('root-admin-manage-leagues-extend-months'), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('root-admin-manage-leagues-extend-submit'));

    expect(await screen.findByTestId('root-admin-manage-leagues-extend-result'))
      .toHaveTextContent(`2 leagues now have a Premium preview period ending on ${new Date('2027-10-24T12:00:00.000Z').toLocaleDateString()}.`);
    expect(extendRunningPlanRenewalsMock).toHaveBeenCalledWith(expect.objectContaining({ body: { months: 6 } }));
    await waitFor(() => expect(listLeaguesMock).toHaveBeenCalledTimes(2));
  });

  it('shows the reason when extending every gift fails', async () => {
    seedLeagues();
    extendRunningPlanRenewalsMock.mockResolvedValue({ error: { error: { code: 'ROOT_ADMIN_ACCESS_REQUIRED', message: 'Root admin access required' } } });

    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-manage-leagues-extend-submit'));

    expect(await screen.findByText('Root admin access required')).toBeInTheDocument();
  });

  it('does not render any lifecycle action controls on the admin list', async () => {
    seedLeagues();

    renderPage();
    searchFor('League');

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
    searchFor('League');

    // #202 — one league list, scope as a parameter. This page asks for `all`, which access
    // rule A1 permits to root admins only; it used to be a separate `adminListLeagues` route.
    await waitFor(() =>
      expect(listLeaguesMock).toHaveBeenLastCalledWith({ query: { scope: 'all', search: 'League' } }),
    );
    await screen.findByTestId('root-admin-manage-leagues-link-league-active-1');

    fireEvent.change(screen.getByTestId('data-grid-filter-name'), {
      target: { value: 'Archive' },
    });

    expect(
      screen.queryByTestId('root-admin-manage-leagues-link-league-active-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('root-admin-manage-leagues-link-league-inactive-1'),
    ).toBeInTheDocument();
    expect(listLeaguesMock).toHaveBeenCalledTimes(1);
  });

  it('narrows the returned leagues to matching names or codes as the search grows', async () => {
    seedLeagues();

    renderPage();
    searchFor('League');

    await screen.findByTestId('root-admin-manage-leagues-link-league-active-1');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a league' }), {
      target: { value: 'Archive' },
    });

    expect(
      screen.queryByTestId('root-admin-manage-leagues-link-league-active-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('root-admin-manage-leagues-link-league-inactive-1'),
    ).toBeInTheDocument();
  });

  it('renders the empty state when no leagues match the current filters', async () => {
    listLeaguesMock.mockResolvedValue({ data: { leagues: [], memberships: [] } });

    renderPage();
    searchFor('League');

    expect(await screen.findByText('No leagues matched the current filters.')).toBeInTheDocument();
  });

  it('shows the error in the grid and keeps the search box when the admin list call fails', async () => {
    listLeaguesMock.mockResolvedValue({
      data: null,
      error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } },
    });

    renderPage();
    searchFor('League');

    expect(await screen.findByText('Boom')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Find a league' })).toHaveValue('League');
  });

  it('asks for at least 3 characters of a name and reads no leagues until they are typed', async () => {
    seedLeagues();
    renderPage();

    expect(
      await screen.findByText("Type at least 3 characters of a league's name to find it."),
    ).toBeInTheDocument();
    searchFor('Al');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(screen.getByText("Type at least 3 characters of a league's name to find it.")).toBeInTheDocument();
    expect(listLeaguesMock).not.toHaveBeenCalled();
  });
});
