import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingConfig, PlanConfig, SettingsGroup } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminPricingPage } from './root-admin-pricing-page';

// /manage/pricing: the Plan prices grid (a row per plan), each plan's view-then-Edit dialog with its
// subscription and expansion bands, and ⚙ Payments.

const mocks = vi.hoisted(() => ({
  getSettingsGroup: vi.fn(),
  updateSettingsGroup: vi.fn(),
}));

bindApiMocks(mocks);

const BILLING: BillingConfig = {
  paymentsEnabled: false,
  planPrices: {
    FREE: { yearlyCents: 0, monthlyCents: 0 },
    PRO: { yearlyCents: 4900, monthlyCents: 499 },
    PREMIUM: { yearlyCents: 9900, monthlyCents: 999 },
    PLATINUM: { yearlyCents: 19900, monthlyCents: 1999 },
  },
  expansionPrices: {
    FREE: [{ entriesPerContest: 50, priceCents: 1000 }, { entriesPerContest: 100, priceCents: 2000 }],
    PRO: [{ entriesPerContest: 100, priceCents: 1500 }, { entriesPerContest: 200, priceCents: 2000 }],
    PREMIUM: [{ entriesPerContest: 250, priceCents: 2000 }],
    PLATINUM: [],
  },
};

const PLANS: PlanConfig = {
  caps: {
    ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100, PLATINUM: null },
    SPORTS_LEAGUES_PER_YEAR: { FREE: 5, PRO: 15, PREMIUM: 30, PLATINUM: 50 },
  },
  features: {
    EMAIL_CONTEST_OPENED: 'FREE',
    EMAIL_CONTEST_ENTRY_COMPLETED: 'FREE',
    EMAIL_CONTEST_RESULTS: 'FREE',
    EMAIL_CONTEST_EVENT_CHANGED: 'FREE',
    EMAIL_CONTEST_STARTED_SUMMARY: 'PRO',
    EMAIL_CONTEST_ENTRY_REMINDER: 'PRO',
    EMAIL_CONTEST_STANDINGS: 'PRO',
    EMAIL_EVENT_COMING_UP: 'PRO',
    EMAIL_EVENT_READY_FOR_CONTESTS: 'PRO',
    EMAIL_CONTEST_NOT_OPEN: 'PRO',
    EMAIL_YEAR_IN_REVIEW: 'PRO',
    EMAIL_LEAGUE_MEMBER_JOINED: 'PRO',
    CUP_STANDINGS: 'PRO',
    CUP_CROWNING: 'PRO',
    CHAMPIONSHIP: 'PRO',
    TROPHY_SHELF: 'PRO',
    CUP_SETTINGS: 'PRO',
    PAST_YEARS: 'PRO',
    ALL_TIME_SUMMARY: 'PREMIUM',
    RECORD_BOOK: 'PREMIUM',
  },
};

const SAVED_AT = '2026-11-12T15:00:00.000Z';

function billingGroup(value: BillingConfig = BILLING, saved = true): SettingsGroup {
  return {
    key: 'BILLING_CONFIG',
    title: 'Payments',
    description: 'Whether payments are on, what each plan costs, and what expanding a contest costs on each plan.',
    source: saved ? 'stored' : 'defaults',
    updatedAt: saved ? SAVED_AT : null,
    updatedBy: saved ? { id: '00000000-0000-4000-8000-000000000001', name: 'Derek' } : null,
    value,
    defaults: BILLING,
  };
}

const PLAN_GROUP: SettingsGroup = {
  key: 'PLAN_CONFIG',
  title: 'Plans',
  description: 'What each league plan allows.',
  source: 'defaults',
  updatedAt: null,
  updatedBy: null,
  value: PLANS,
  defaults: PLANS,
};

function seed({ billing = billingGroup(), plansFail = false }: { billing?: SettingsGroup; plansFail?: boolean } = {}) {
  mocks.getSettingsGroup.mockImplementation(({ path }: { path: { key: string } }) => {
    if (path.key === 'BILLING_CONFIG') return Promise.resolve({ data: billing });
    return Promise.resolve(plansFail
      ? { error: { error: { code: 'INTERNAL_ERROR', message: 'Plans are down.' } }, status: 500 }
      : { data: PLAN_GROUP });
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/pricing']}>
        <RootAdminPricingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The value the one save sent. */
function savedValue(): BillingConfig {
  const call = mocks.updateSettingsGroup.mock.calls[0]?.[0] as { body: { value: BillingConfig; expectedUpdatedAt: string | null } };
  return call.body.value;
}

async function openPlanEdit(plan: string) {
  await userEvent.click(await screen.findByTestId(`root-admin-plan-price-${plan}`));
  await userEvent.click(await screen.findByTestId('root-admin-plan-price-dialog-edit'));
}

describe('RootAdminPricingPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists a row per plan, lowest first, with its yearly and monthly price, entries included from Plans, Unlimited as a word, and its bands in a line', async () => {
    seed();
    renderPage();

    const pro = within(await screen.findByTestId('root-admin-plan-price-PRO'));
    expect(pro.getByText('Pro')).toBeInTheDocument();
    expect(pro.getByText('$49')).toBeInTheDocument();
    expect(pro.getByText('$4.99')).toBeInTheDocument();
    expect(pro.getByText('50')).toBeInTheDocument();
    expect(pro.getByText('100 for $15 · 200 for $20')).toBeInTheDocument();
    const platinum = within(screen.getByTestId('root-admin-plan-price-PLATINUM'));
    expect(platinum.getByText('Unlimited')).toBeInTheDocument();
    expect(platinum.getByText('—')).toBeInTheDocument();
    const order = screen.getAllByTestId(/^root-admin-plan-price-(FREE|PRO|PREMIUM|PLATINUM)$/).map((row) => row.getAttribute('data-testid'));
    expect(order).toEqual(['FREE', 'PRO', 'PREMIUM', 'PLATINUM'].map((plan) => `root-admin-plan-price-${plan}`));
    expect(screen.getByTestId('root-admin-pricing-payments-state')).toHaveTextContent('Payments off');
  });

  it('says why when the plans cannot be read, instead of a grid without entries', async () => {
    seed({ plansFail: true });
    renderPage();

    expect(await screen.findByText('Plans are down.')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-plan-prices-table')).not.toBeInTheDocument();
  });

  it('opens a plan in view with its subscription and expansion bands, Close and Edit, entries included marked as set in Plans', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-plan-price-PRO'));
    const dialog = within(await screen.findByTestId('root-admin-plan-price-dialog'));
    expect(dialog.getByText('Subscription')).toBeInTheDocument();
    expect(dialog.getByText('Expansion bands')).toBeInTheDocument();
    expect(dialog.getByTestId('root-admin-plan-price-dialog-yearly')).toHaveTextContent('$49');
    expect(dialog.getByTestId('root-admin-plan-price-dialog-monthly')).toHaveTextContent('$4.99');
    expect(dialog.getByTestId('root-admin-plan-price-dialog-entries-included')).toHaveTextContent('50Set in Plans');
    expect(within(dialog.getByTestId('root-admin-plan-price-dialog-band-200')).getByText('$20')).toBeInTheDocument();

    await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('root-admin-plan-price-dialog')).not.toBeInTheDocument();
  });

  it('says a plan with no bands has no expansions', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-plan-price-PLATINUM'));
    expect(await screen.findByTestId('root-admin-plan-price-dialog-no-bands')).toHaveTextContent('No expansions on this plan.');
  });

  it('saves a changed yearly and monthly price, a changed band, a removed band and an added band in cents, with only that plan changed and the version it was opened on, then comes back to the view', async () => {
    seed();
    mocks.updateSettingsGroup.mockResolvedValue({ data: billingGroup() });
    renderPage();

    await openPlanEdit('PRO');
    const yearly = screen.getByTestId('root-admin-plan-price-dialog-yearly-input');
    await userEvent.clear(yearly);
    await userEvent.type(yearly, '59.5');
    const monthly = screen.getByTestId('root-admin-plan-price-dialog-monthly-input');
    await userEvent.clear(monthly);
    await userEvent.type(monthly, '5.99');
    await userEvent.click(screen.getByTestId('root-admin-plan-price-dialog-band-remove-0'));
    const price = screen.getByTestId('root-admin-plan-price-dialog-band-price-0');
    await userEvent.clear(price);
    await userEvent.type(price, '25');
    await userEvent.click(screen.getByTestId('root-admin-plan-price-dialog-band-add'));
    await userEvent.type(screen.getByTestId('root-admin-plan-price-dialog-band-entries-1'), '500');
    await userEvent.type(screen.getByTestId('root-admin-plan-price-dialog-band-price-1'), '40');
    await userEvent.click(screen.getByTestId('root-admin-plan-price-dialog-save'));

    await waitFor(() => expect(mocks.updateSettingsGroup).toHaveBeenCalledTimes(1));
    expect(mocks.updateSettingsGroup).toHaveBeenCalledWith(expect.objectContaining({
      path: { key: 'BILLING_CONFIG' },
      body: {
        key: 'BILLING_CONFIG',
        expectedUpdatedAt: SAVED_AT,
        value: {
          ...BILLING,
          planPrices: { ...BILLING.planPrices, PRO: { yearlyCents: 5950, monthlyCents: 599 } },
          expansionPrices: {
            ...BILLING.expansionPrices,
            PRO: [{ entriesPerContest: 200, priceCents: 2500 }, { entriesPerContest: 500, priceCents: 4000 }],
          },
        },
      },
    }));
    expect(await screen.findByTestId('root-admin-plan-price-dialog-edit')).toBeInTheDocument();
  });

  it('refuses a band that does not rise above the one before, in entries or in price, naming it in the dialog and sending nothing', async () => {
    seed();
    renderPage();

    await openPlanEdit('FREE');
    const entries = screen.getByTestId('root-admin-plan-price-dialog-band-entries-1');
    await userEvent.clear(entries);
    await userEvent.type(entries, '40');
    const price = screen.getByTestId('root-admin-plan-price-dialog-band-price-1');
    await userEvent.clear(price);
    await userEvent.type(price, '5');
    await userEvent.click(screen.getByTestId('root-admin-plan-price-dialog-save'));

    expect(await screen.findByText('Above 50, the band before.')).toBeInTheDocument();
    expect(screen.getByText('Above the band before\'s price.')).toBeInTheDocument();
    expect(mocks.updateSettingsGroup).not.toHaveBeenCalled();
  });

  it('asks for a number when a new band is left blank, and says a size or price is out of range rather than blank', async () => {
    seed();
    renderPage();

    await openPlanEdit('PLATINUM');
    await userEvent.click(screen.getByTestId('root-admin-plan-price-dialog-band-add'));
    await userEvent.type(screen.getByTestId('root-admin-plan-price-dialog-band-price-0'), '20000');
    await userEvent.click(screen.getByTestId('root-admin-plan-price-dialog-save'));
    expect(await screen.findByText('Enter a number of entries.')).toBeInTheDocument();
    expect(screen.getByText('At most $10,000.')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('root-admin-plan-price-dialog-band-entries-0'), '0');
    expect(await screen.findByText('At least 1 entry.')).toBeInTheDocument();
    expect(screen.queryByText('Enter a number of entries.')).not.toBeInTheDocument();
    expect(mocks.updateSettingsGroup).not.toHaveBeenCalled();
  });

  it('offers + Add band only while the plan has fewer than 10 bands', async () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ entriesPerContest: (index + 1) * 100, priceCents: (index + 1) * 1000 }));
    seed({ billing: billingGroup({ ...BILLING, expansionPrices: { ...BILLING.expansionPrices, PREMIUM: ten.slice(0, 9) } }) });
    renderPage();

    await openPlanEdit('PREMIUM');
    await userEvent.click(screen.getByTestId('root-admin-plan-price-dialog-band-add'));
    expect(screen.getByTestId('root-admin-plan-price-dialog-band-row-9')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-plan-price-dialog-band-add')).not.toBeInTheDocument();
  });

  it('Cancel drops the edits and comes back to the view as it was', async () => {
    seed();
    renderPage();

    await openPlanEdit('PRO');
    const yearly = screen.getByTestId('root-admin-plan-price-dialog-yearly-input');
    await userEvent.clear(yearly);
    await userEvent.type(yearly, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('root-admin-plan-price-dialog-yearly')).toHaveTextContent('$49');
    expect(mocks.updateSettingsGroup).not.toHaveBeenCalled();
  });

  it('keeps the dialog in edit with the server\'s reason when someone saved first, and Load the latest prices starts the form from theirs', async () => {
    seed();
    mocks.updateSettingsGroup.mockResolvedValue({
      error: { error: { code: 'SETTINGS_CONFLICT', message: 'Someone else saved the payments settings first. Reload to see them.' } },
      status: 409,
    });
    renderPage();

    await openPlanEdit('PRO');
    const monthly = screen.getByTestId('root-admin-plan-price-dialog-monthly-input');
    await userEvent.clear(monthly);
    await userEvent.type(monthly, '6');
    await userEvent.click(screen.getByTestId('root-admin-plan-price-dialog-save'));

    expect(await screen.findByText('Someone else saved the payments settings first. Reload to see them.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-plan-price-dialog-save')).toBeInTheDocument();

    const theirs = billingGroup({ ...BILLING, planPrices: { ...BILLING.planPrices, PRO: { yearlyCents: 7000, monthlyCents: 700 } } });
    seed({ billing: { ...theirs, updatedAt: '2026-11-13T15:00:00.000Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'Load the latest prices' }));
    await waitFor(() => expect(screen.getByTestId('root-admin-plan-price-dialog-monthly-input')).toHaveValue(7));
    expect(screen.queryByTestId('root-admin-plan-price-dialog-error')).not.toBeInTheDocument();
  });

  it('opens ⚙ Payments in view with Off and who last changed it, then Edit switches payments on and saves only that', async () => {
    seed();
    mocks.updateSettingsGroup.mockResolvedValue({ data: billingGroup({ ...BILLING, paymentsEnabled: true }) });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-pricing-payments'));
    const dialog = within(await screen.findByTestId('root-admin-payments-dialog'));
    expect(dialog.getByTestId('root-admin-payments-dialog-payments')).toHaveTextContent('Off');
    expect(dialog.getByTestId('root-admin-payments-dialog-last-changed')).toHaveTextContent('Derek on');

    await userEvent.click(dialog.getByTestId('root-admin-payments-dialog-edit'));
    expect(screen.getByTestId('root-admin-payments-dialog-save')).toBeDisabled();
    await userEvent.selectOptions(screen.getByTestId('root-admin-payments-dialog-payments-input'), 'on');
    await userEvent.click(screen.getByTestId('root-admin-payments-dialog-save'));

    await waitFor(() => expect(mocks.updateSettingsGroup).toHaveBeenCalledTimes(1));
    expect(savedValue()).toEqual({ ...BILLING, paymentsEnabled: true });
    expect(await screen.findByTestId('root-admin-payments-dialog-edit')).toBeInTheDocument();
  });

  it('says a payments setting never saved is on the defaults, and Cancel leaves it unchanged', async () => {
    seed({ billing: billingGroup(BILLING, false) });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-pricing-payments'));
    expect(await screen.findByTestId('root-admin-payments-dialog-last-changed')).toHaveTextContent('Never: on the defaults');
    await userEvent.click(screen.getByTestId('root-admin-payments-dialog-edit'));
    await userEvent.selectOptions(screen.getByTestId('root-admin-payments-dialog-payments-input'), 'on');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('root-admin-payments-dialog-payments')).toHaveTextContent('Off');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('root-admin-payments-dialog')).not.toBeInTheDocument();
    expect(mocks.updateSettingsGroup).not.toHaveBeenCalled();
  });

  it('switches payments that are on back off, naming an admin it cannot find as unknown, and saves only that', async () => {
    const on = { ...billingGroup({ ...BILLING, paymentsEnabled: true }), updatedBy: null };
    seed({ billing: on });
    mocks.updateSettingsGroup.mockResolvedValue({ data: billingGroup() });
    renderPage();

    expect(await screen.findByTestId('root-admin-pricing-payments-state')).toHaveTextContent('Payments on');
    await userEvent.click(screen.getByTestId('root-admin-pricing-payments'));
    expect(await screen.findByTestId('root-admin-payments-dialog-payments')).toHaveTextContent('On');
    expect(screen.getByTestId('root-admin-payments-dialog-last-changed')).toHaveTextContent('an unknown admin on');
    await userEvent.click(screen.getByTestId('root-admin-payments-dialog-edit'));
    await userEvent.selectOptions(screen.getByTestId('root-admin-payments-dialog-payments-input'), 'off');
    await userEvent.click(screen.getByTestId('root-admin-payments-dialog-save'));

    await waitFor(() => expect(mocks.updateSettingsGroup).toHaveBeenCalledTimes(1));
    expect(savedValue()).toEqual({ ...BILLING, paymentsEnabled: false });
  });

  it('closes the plan dialog and the payments dialog on Escape', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-plan-price-PRO'));
    await screen.findByTestId('root-admin-plan-price-dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('root-admin-plan-price-dialog')).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId('root-admin-pricing-payments'));
    await screen.findByTestId('root-admin-payments-dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('root-admin-payments-dialog')).not.toBeInTheDocument());
  });
});
