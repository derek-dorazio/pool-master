import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaguePlan, PlanFeature } from '@poolmaster/shared/domain';
import { apiSuccess, buildLeague, buildLeagueMembership, listLeaguesData } from '@/features/leagues/test/fixtures';
import { bindApiMocks } from '@/test/msw-api';
import { PublicPlansPage } from './public-plans-page';
import { buildPlanEntitlements } from './test/fixtures';

const { authState, listLeaguePlansMock, listLeaguesMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    authState: { isAuthenticated: false, isLoading: false, isRootAdmin: false, user: null },
    listLeaguePlansMock: vi.fn(),
    listLeaguesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({ listLeaguePlans: listLeaguePlansMock, listLeagues: listLeaguesMock });

vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => authState }));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const FREE_FEATURES = [
  PlanFeature.EMAIL_CONTEST_OPENED,
  PlanFeature.EMAIL_CONTEST_ENTRY_COMPLETED,
  PlanFeature.EMAIL_CONTEST_RESULTS,
  PlanFeature.EMAIL_CONTEST_EVENT_CHANGED,
];
const PRO_FEATURES = Object.values(PlanFeature).filter((feature) => feature !== PlanFeature.ALL_TIME_SUMMARY && feature !== PlanFeature.RECORD_BOOK);

const PLANS = [
  buildPlanEntitlements({ plan: LeaguePlan.FREE, caps: { ENTRIES_PER_CONTEST: 20, SPORTS_LEAGUES_PER_YEAR: 1 }, features: FREE_FEATURES }),
  buildPlanEntitlements({ plan: LeaguePlan.PRO, caps: { ENTRIES_PER_CONTEST: 50, SPORTS_LEAGUES_PER_YEAR: 3 }, features: PRO_FEATURES }),
  buildPlanEntitlements({ plan: LeaguePlan.PREMIUM, caps: { ENTRIES_PER_CONTEST: 100, SPORTS_LEAGUES_PER_YEAR: 10 }, features: [...PRO_FEATURES, PlanFeature.ALL_TIME_SUMMARY] }),
  buildPlanEntitlements(),
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/plans']}>
        <PublicPlansPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PublicPlansPage', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    listLeaguePlansMock.mockResolvedValue(apiSuccess({ plans: PLANS }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a visitor all four plans with the caps from the plan settings, every one free for now', async () => {
    renderPage();

    const free = within(await screen.findByTestId('plan-card-FREE'));
    expect(free.getByTestId('plan-card-FREE-price')).toHaveTextContent(/^\$0$/);
    expect(free.getByTestId('plan-card-FREE-highlights')).toHaveTextContent('Up to 20 entries per contest');
    for (const plan of [LeaguePlan.PRO, LeaguePlan.PREMIUM, LeaguePlan.PLATINUM]) {
      expect(screen.getByTestId(`plan-card-${plan}-price`)).toHaveTextContent('Freefor now');
    }
    const pro = within(screen.getByTestId('plan-card-PRO'));
    expect(pro.getByText('Everything in Free, plus')).toBeInTheDocument();
    expect(pro.getByTestId('plan-card-PRO-highlights')).toHaveTextContent('8 more emails');
    expect(screen.getByTestId('plan-card-PREMIUM-highlights')).toHaveTextContent('All years');
    expect(screen.getByTestId('public-plans-free-note')).toHaveTextContent('Every plan is free for now');
    expect(listLeaguesMock).not.toHaveBeenCalled();
  });

  it('sends every Start free button to sign-up, since every new league starts free', async () => {
    renderPage();

    const start = await screen.findByTestId('public-plans-card-PREMIUM-start');
    expect(start).toHaveTextContent('Start free');
    expect(start).toHaveAttribute('href', '/');
    expect(screen.getByTestId('public-plans-start-footer')).toHaveTextContent('Start free');
  });

  it('starts the comparison with the twelve emails folded to a count per plan, and opens them on a tap', async () => {
    renderPage();
    const emails = within(await screen.findByTestId('plan-comparison-section-EMAILS'));

    expect(emails.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['4 of 12', '12 of 12', '12 of 12', '12 of 12']);
    expect(emails.queryByTestId('plan-comparison-row-EMAIL_CONTEST_ENTRY_REMINDER')).not.toBeInTheDocument();

    fireEvent.click(emails.getByTestId('plan-comparison-toggle-EMAILS'));

    const reminder = within(emails.getByTestId('plan-comparison-row-EMAIL_CONTEST_ENTRY_REMINDER'));
    expect(reminder.getByText('Nudges members who haven\'t entered yet.')).toBeInTheDocument();
    expect(reminder.getAllByLabelText(/included/i).map((icon) => icon.getAttribute('aria-label')))
      .toEqual(['Not included', 'Included', 'Included', 'Included']);
  });

  it('sends a signed-in commissioner of one league straight to that league\'s plan page', async () => {
    authState.isAuthenticated = true;
    listLeaguesMock.mockResolvedValue(apiSuccess(listLeaguesData([buildLeague()], [buildLeagueMembership()])));

    renderPage();

    const choose = await screen.findByTestId('public-plans-card-PRO-start');
    expect(choose).toHaveTextContent('Choose for a league');
    await vi.waitFor(() => expect(choose).toHaveAttribute('href', '/league/BIGDAWGS/admin/plan/edit'));
  });

  it('sends a signed-in member who runs no league, or several, to their leagues', async () => {
    authState.isAuthenticated = true;
    listLeaguesMock.mockResolvedValue(apiSuccess(listLeaguesData([
      buildLeague(),
      buildLeague({ id: 'league-2', leagueCode: 'SECOND' }),
    ], [buildLeagueMembership(), buildLeagueMembership({ id: 'membership-2', leagueId: 'league-2' })])));

    renderPage();

    const choose = await screen.findByTestId('public-plans-start');
    await vi.waitFor(() => expect(listLeaguesMock).toHaveBeenCalled());
    expect(choose).toHaveAttribute('href', '/my-leagues');
  });

  it('says the plans could not load, and shows no plan, when the plan list fails', async () => {
    listLeaguePlansMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'boom' } } });

    renderPage();

    expect(await screen.findByText('Plans unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-cards')).not.toBeInTheDocument();
  });
});
