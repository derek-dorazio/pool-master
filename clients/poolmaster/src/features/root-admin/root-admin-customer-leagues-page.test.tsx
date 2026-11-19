import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerLeagueDto } from '@/lib/api';
import { Toaster } from '@/features/shared/ui';
import { bindApiMocks } from '@/test/msw-api';
import { applyTextFilter } from '@/test/data-grid-filters';
import { RootAdminCustomerLeaguesPage } from './root-admin-customer-leagues-page';

// /manage/customers/leagues: every league in one grid, each opening its view-then-Edit dialog,
// and the header's Extend every running Premium preview.

const mocks = vi.hoisted(() => ({
  listCustomerLeagues: vi.fn(),
  updateLeaguePlan: vi.fn(),
  extendLeaguePlanRenewal: vi.fn(),
  extendRunningPlanRenewals: vi.fn(),
}));

bindApiMocks(mocks);

function league(overrides: Partial<CustomerLeagueDto> = {}): CustomerLeagueDto {
  return {
    id: 'league-1',
    leagueCode: 'OFFICE1',
    name: 'Office Pool',
    isActive: true,
    plan: 'PRO',
    owner: { userId: 'user-1', firstName: 'Ana', lastName: 'Owner' },
    memberCount: 12,
    activeContestCount: 3,
    previewEndsAt: '2027-04-24T12:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

const LEAGUES = [
  league(),
  league({ id: 'league-2', leagueCode: 'FAMILY2', name: 'Family Picks', plan: 'FREE', owner: null, memberCount: 0, activeContestCount: 0, previewEndsAt: null }),
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/customers/leagues']}>
        <RootAdminCustomerLeaguesPage />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openLeague(id: string) {
  fireEvent.click(within(await screen.findByTestId(`root-admin-customer-league-${id}`)).getByRole('button', { name: 'Open details' }));
  return screen.findByTestId('root-admin-customer-league-dialog');
}

describe('RootAdminCustomerLeaguesPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists every league with its code, plan, members, active contests and preview end, under the Customers tabs with Leagues lit', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ data: { leagues: LEAGUES } });
    renderPage();

    const office = within(await screen.findByTestId('root-admin-customer-league-league-1'));
    expect(office.getByText('Office Pool')).toBeInTheDocument();
    expect(office.getByText('OFFICE1')).toBeInTheDocument();
    expect(office.getByText('Pro')).toBeInTheDocument();
    expect(office.getByText('12')).toBeInTheDocument();
    expect(office.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Premium preview ends/ })).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-customers-tab-leagues')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-customers-tab-users')).toHaveAttribute('href', '/manage/customers/users');
  });

  it('filters the loaded leagues in the grid, without asking the server again', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ data: { leagues: LEAGUES } });
    renderPage();
    await screen.findByTestId('root-admin-customer-league-league-1');

    applyTextFilter('root-admin-customer-leagues-filter-name', 'family');

    expect(screen.queryByTestId('root-admin-customer-league-league-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-customer-league-league-2')).toBeInTheDocument();
    expect(mocks.listCustomerLeagues).toHaveBeenCalledTimes(1);
  });

  it('says why when the leagues cannot load', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ error: { error: { code: 'CUSTOMERS_RATE_LIMITED', message: 'Too many reads; try again in a minute.' } } });
    renderPage();

    expect(await screen.findByText('Too many reads; try again in a minute.')).toBeInTheDocument();
  });

  it('opens a league in view mode with its Details, an Actions row opening the league, and Close and Edit', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ data: { leagues: LEAGUES } });
    renderPage();

    const dialog = within(await openLeague('league-1'));
    const details = within(screen.getByTestId('root-admin-customer-league-dialog-details'));
    expect(details.getByTestId('root-admin-customer-league-dialog-code')).toHaveTextContent('OFFICE1');
    expect(details.getByTestId('root-admin-customer-league-dialog-plan')).toHaveTextContent('Pro');
    expect(details.getByTestId('root-admin-customer-league-dialog-owner')).toHaveTextContent('Ana Owner');
    expect(details.getByTestId('root-admin-customer-league-dialog-members')).toHaveTextContent('12');
    expect(details.getByTestId('root-admin-customer-league-dialog-active-contests')).toHaveTextContent('3');
    expect(details.getByTestId('root-admin-customer-league-dialog-preview')).toHaveTextContent('Ends');
    const actions = within(screen.getByTestId('root-admin-customer-league-dialog-actions'));
    expect(actions.getByTestId('root-admin-customer-league-dialog-open-league')).toHaveAttribute('href', '/league/OFFICE1');
    expect(dialog.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(dialog.getByTestId('root-admin-customer-league-dialog-edit')).toBeInTheDocument();
  });

  it('names no owner and no preview for a league without an active commissioner or a running preview', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ data: { leagues: LEAGUES } });
    renderPage();

    await openLeague('league-2');
    expect(screen.getByTestId('root-admin-customer-league-dialog-owner')).toHaveTextContent('No active commissioner');
    expect(screen.getByTestId('root-admin-customer-league-dialog-preview')).toHaveTextContent('None');
  });

  it('saves a changed plan and a picked preview extension, then returns to view mode and reloads the leagues', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ data: { leagues: LEAGUES } });
    mocks.updateLeaguePlan.mockResolvedValue({ data: { league: {} } });
    mocks.extendLeaguePlanRenewal.mockResolvedValue({ data: { league: {} } });
    renderPage();

    await openLeague('league-1');
    fireEvent.click(screen.getByTestId('root-admin-customer-league-dialog-edit'));
    fireEvent.change(screen.getByTestId('root-admin-customer-league-dialog-plan-input'), { target: { value: 'PREMIUM' } });
    fireEvent.change(screen.getByTestId('root-admin-customer-league-dialog-extend-input'), { target: { value: '6' } });
    await waitFor(() => expect(screen.getByTestId('root-admin-customer-league-dialog-save')).toBeEnabled());
    fireEvent.click(screen.getByTestId('root-admin-customer-league-dialog-save'));

    await waitFor(() => expect(mocks.extendLeaguePlanRenewal).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' }, body: { months: 6 } })));
    expect(mocks.updateLeaguePlan).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' }, body: { plan: 'PREMIUM' } }));
    expect(await screen.findByTestId('root-admin-customer-league-dialog-edit')).toBeInTheDocument();
    await waitFor(() => expect(mocks.listCustomerLeagues).toHaveBeenCalledTimes(2));
  });

  it('sends only the plan when no extension is picked, and keeps a refused save in the form with its reason', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ data: { leagues: LEAGUES } });
    mocks.updateLeaguePlan.mockResolvedValue({ error: { error: { code: 'LEAGUE_PLAN_INVALID', message: 'That plan cannot be set.' } } });
    renderPage();

    await openLeague('league-1');
    fireEvent.click(screen.getByTestId('root-admin-customer-league-dialog-edit'));
    fireEvent.change(screen.getByTestId('root-admin-customer-league-dialog-plan-input'), { target: { value: 'FREE' } });
    await waitFor(() => expect(screen.getByTestId('root-admin-customer-league-dialog-save')).toBeEnabled());
    fireEvent.click(screen.getByTestId('root-admin-customer-league-dialog-save'));

    expect(await screen.findByText(/That plan cannot be set\./)).toBeInTheDocument();
    expect(mocks.extendLeaguePlanRenewal).not.toHaveBeenCalled();
    expect(screen.getByTestId('root-admin-customer-league-dialog-save')).toBeInTheDocument();
  });

  it('cancels an edit back to the view, unsaved, and Close closes the dialog', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ data: { leagues: LEAGUES } });
    renderPage();

    const dialog = within(await openLeague('league-1'));
    fireEvent.click(screen.getByTestId('root-admin-customer-league-dialog-edit'));
    fireEvent.change(screen.getByTestId('root-admin-customer-league-dialog-plan-input'), { target: { value: 'FREE' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('root-admin-customer-league-dialog-plan')).toHaveTextContent('Pro');
    expect(mocks.updateLeaguePlan).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('root-admin-customer-league-dialog')).not.toBeInTheDocument());
  });

  it('extends every running preview by the months confirmed in the header dialog, says how many leagues moved, and reloads the leagues', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ data: { leagues: LEAGUES } });
    mocks.extendRunningPlanRenewals.mockResolvedValue({ data: { extendedCount: 2, renewsAt: '2027-10-24T12:00:00.000Z' } });
    renderPage();
    await screen.findByTestId('root-admin-customer-league-league-1');

    fireEvent.click(screen.getByTestId('root-admin-customers-extend-previews-open'));
    expect(await screen.findByTestId('root-admin-customers-extend-previews-dialog')).toBeInTheDocument();
    expect(mocks.extendRunningPlanRenewals).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('root-admin-customers-extend-previews-months'), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('root-admin-customers-extend-previews-submit'));

    expect(await screen.findByText(/2 leagues now have a Premium preview ending on/)).toBeInTheDocument();
    expect(mocks.extendRunningPlanRenewals).toHaveBeenCalledWith(expect.objectContaining({ body: { months: 6 } }));
    await waitFor(() => expect(screen.queryByTestId('root-admin-customers-extend-previews-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.listCustomerLeagues).toHaveBeenCalledTimes(2));
  });

  it('keeps the extend dialog open with the reason when extending is refused, and Cancel closes it unsent', async () => {
    mocks.listCustomerLeagues.mockResolvedValue({ data: { leagues: LEAGUES } });
    mocks.extendRunningPlanRenewals.mockResolvedValue({ error: { error: { code: 'ROOT_ADMIN_ACCESS_REQUIRED', message: 'Root admin access required' } } });
    renderPage();
    await screen.findByTestId('root-admin-customer-league-league-1');

    fireEvent.click(screen.getByTestId('root-admin-customers-extend-previews-open'));
    fireEvent.click(await screen.findByTestId('root-admin-customers-extend-previews-submit'));
    expect(await screen.findByText('Root admin access required')).toBeInTheDocument();
    expect(mocks.extendRunningPlanRenewals).toHaveBeenCalledWith(expect.objectContaining({ body: { months: 1 } }));

    fireEvent.click(within(screen.getByTestId('root-admin-customers-extend-previews-dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('root-admin-customers-extend-previews-dialog')).not.toBeInTheDocument());
  });
});
