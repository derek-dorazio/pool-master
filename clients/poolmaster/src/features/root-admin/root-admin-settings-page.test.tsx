import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsChange, SettingsGroup } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSettingsPage } from './root-admin-settings-page';

const { listSettingsGroupsMock, listSettingsGroupHistoryMock, updateSettingsGroupMock } = vi.hoisted(() => ({
  listSettingsGroupsMock: vi.fn(),
  listSettingsGroupHistoryMock: vi.fn(),
  updateSettingsGroupMock: vi.fn(),
}));

bindApiMocks({
  listSettingsGroups: listSettingsGroupsMock,
  listSettingsGroupHistory: listSettingsGroupHistoryMock,
  updateSettingsGroup: updateSettingsGroupMock,
});

const INGESTION_DEFAULTS = {
  scheduledSports: ['GOLF' as const],
  healthCheck: { enabled: true, intervalMinutes: 5 },
  eventParticipants: { enabled: false, intervalMinutes: 360, lookaheadDays: 14 },
  eventLiveScores: { enabled: true, intervalSeconds: 300 },
  eventList: { enabled: true, intervalMinutes: 360 },
};

const ADMIN = { id: '6f7c1c55-58a4-4bd4-8a2a-0b8e3f1f4a01', name: 'Ada Admin' };

const SAVED_INGESTION_VALUE = { ...INGESTION_DEFAULTS, eventLiveScores: { enabled: true, intervalSeconds: 45 } };

const SAVED_INGESTION: SettingsGroup = {
  key: 'INGESTION_SCHEDULE_CONFIG',
  title: 'Ingestion schedule',
  description: 'Which sports sync on a schedule, and how often each provider feed runs.',
  source: 'stored',
  updatedAt: '2026-10-07T12:00:00.000Z',
  updatedBy: ADMIN,
  value: SAVED_INGESTION_VALUE,
  defaults: INGESTION_DEFAULTS,
};

const EMAIL_DEFAULTS = {
  enabled: true,
  allowedRecipients: [] as string[],
  sendRatePerSecond: 10,
  entryReminderHours: [48, 24, 3],
  standingsBufferMinutes: 30,
  weeklyDigestHour: 3,
  templates: {
    LEAGUE_MEMBER_INVITE: true,
    LEAGUE_JOIN_SUCCESS: true,
    CONTEST_ENTRY_COMPLETED: true,
    CONTEST_STARTED_SUMMARY: true,
    CONTEST_ENTRY_REMINDER: true,
    CONTEST_OPENED: true,
    CONTEST_STANDINGS: true,
    CONTEST_RESULTS: true,
    CONTEST_EVENT_CHANGED: true,
    CONTEST_REOPENED: true,
    EVENT_COMING_UP: true,
    EVENT_READY_FOR_CONTESTS: true,
    EVENT_WEEKLY_DIGEST: true,
    LEAGUE_MEMBER_JOINED: true,
    CONTEST_EXPANDED: true,
    LEAGUE_PLAN_PREVIEW_ENDING: true,
    CONTEST_NOT_OPEN: true,
    EVENT_STILL_DRAFT: true,
    SQUAD_OWNER_INVITE: true,
    SQUAD_OWNER_ADDED: true,
    YEAR_IN_REVIEW: true,
  },
};

const DEFAULT_EMAIL: SettingsGroup = {
  key: 'EMAIL_CONFIG',
  title: 'Email',
  description: 'Whether system email is sent, which emails, and who it may go to.',
  source: 'defaults',
  updatedAt: null,
  updatedBy: null,
  value: EMAIL_DEFAULTS,
  defaults: EMAIL_DEFAULTS,
};

const PLAN_PRICES = {
  FREE: { yearlyCents: 0, monthlyCents: 0 },
  PRO: { yearlyCents: 9900, monthlyCents: 999 },
  PREMIUM: { yearlyCents: 0, monthlyCents: 0 },
  PLATINUM: { yearlyCents: 0, monthlyCents: 0 },
};

const BILLING_DEFAULTS = {
  paymentsEnabled: false,
  planPrices: PLAN_PRICES,
  expansionPrices: {
    FREE: [{ entriesPerContest: 50, priceCents: 1000 }, { entriesPerContest: 100, priceCents: 2000 }],
    PRO: [{ entriesPerContest: 100, priceCents: 1500 }],
    PREMIUM: [],
    PLATINUM: [{ entriesPerContest: 1000, priceCents: 3000 }],
  },
};

const DEFAULT_BILLING: SettingsGroup = {
  key: 'BILLING_CONFIG',
  title: 'Payments',
  description: 'Whether payments are on, and what expanding a contest costs on each plan.',
  source: 'defaults',
  updatedAt: null,
  updatedBy: null,
  value: BILLING_DEFAULTS,
  defaults: BILLING_DEFAULTS,
};

const INGESTION_CHANGE: SettingsChange = {
  id: '0c9e1b6e-7a77-4f41-9c3e-5c0b5f6b4a10',
  key: 'INGESTION_SCHEDULE_CONFIG',
  previousValue: INGESTION_DEFAULTS,
  newValue: SAVED_INGESTION_VALUE,
  changedAt: '2026-10-07T12:00:00.000Z',
  changedBy: ADMIN,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminSettingsPage', () => {
  beforeEach(() => {
    listSettingsGroupsMock.mockReset();
    listSettingsGroupHistoryMock.mockReset();
    updateSettingsGroupMock.mockReset();
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [SAVED_INGESTION, DEFAULT_EMAIL] } });
    listSettingsGroupHistoryMock.mockResolvedValue({ data: { changes: [INGESTION_CHANGE] } });
  });

  it('shows one card per group with its values, whether they are saved or the defaults, and who last changed them', async () => {
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [SAVED_INGESTION, DEFAULT_BILLING] } });
    renderPage();

    const ingestion = within(await screen.findByTestId('root-admin-settings-group-INGESTION_SCHEDULE_CONFIG'));
    const billing = within(screen.getByTestId('root-admin-settings-group-BILLING_CONFIG'));

    expect(ingestion.getByText('Saved')).toBeInTheDocument();
    expect(ingestion.getByText('Every 45 s')).toBeInTheDocument();
    expect(ingestion.getByTestId('root-admin-settings-last-change-INGESTION_SCHEDULE_CONFIG')).toHaveTextContent('Last changed by Ada Admin');
    expect(billing.getByText('Defaults')).toBeInTheDocument();
    expect(billing.getByText('Never changed: using the defaults.')).toBeInTheDocument();
  });

  it('leaves the email settings out: they are Notifications\' Email settings', async () => {
    renderPage();

    expect(await screen.findByTestId('root-admin-settings-group-INGESTION_SCHEDULE_CONFIG')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-settings-group-EMAIL_CONFIG')).not.toBeInTheDocument();
  });

  it('links the ingestion schedule section to the Providers page, where it is edited', async () => {
    renderPage();

    expect(await screen.findByTestId('root-admin-settings-edit-INGESTION_SCHEDULE_CONFIG'))
      .toHaveAttribute('href', '/manage/providers');
  });

  it('loads a group\'s recent changes only when asked, naming who changed which field', async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-settings-history-toggle-INGESTION_SCHEDULE_CONFIG'));

    const history = await screen.findByTestId('root-admin-settings-history-INGESTION_SCHEDULE_CONFIG');
    expect(history).toHaveTextContent('by Ada Admin: changed eventLiveScores');
    expect(listSettingsGroupHistoryMock).toHaveBeenCalledTimes(1);
    expect(listSettingsGroupHistoryMock.mock.calls[0][0]).toEqual(expect.objectContaining({ path: { key: 'INGESTION_SCHEDULE_CONFIG' } }));
  });

  it('shows an error state, not stale or sample values, when settings cannot load', async () => {
    listSettingsGroupsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'down' } } });

    renderPage();

    expect(await screen.findByTestId('root-admin-settings-error')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-settings-group-INGESTION_SCHEDULE_CONFIG')).not.toBeInTheDocument();
  });
});

describe('RootAdminSettingsPage plans card', () => {
  const PLAN_DEFAULTS = {
    caps: {
      ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: null, PLATINUM: null },
      SPORTS_LEAGUES_PER_YEAR: { FREE: 5, PRO: 15, PREMIUM: 30, PLATINUM: 50 },
    },
    features: {
      EMAIL_CONTEST_OPENED: 'FREE', EMAIL_CONTEST_ENTRY_COMPLETED: 'FREE', EMAIL_CONTEST_RESULTS: 'FREE',
      EMAIL_CONTEST_EVENT_CHANGED: 'FREE', EMAIL_CONTEST_STARTED_SUMMARY: 'PRO', EMAIL_CONTEST_ENTRY_REMINDER: 'PRO',
      EMAIL_CONTEST_STANDINGS: 'PRO', EMAIL_EVENT_COMING_UP: 'PRO', EMAIL_EVENT_READY_FOR_CONTESTS: 'PRO',
      EMAIL_CONTEST_NOT_OPEN: 'PRO', EMAIL_YEAR_IN_REVIEW: 'PRO', EMAIL_LEAGUE_MEMBER_JOINED: 'PRO', CUP_STANDINGS: 'PRO', CUP_CROWNING: 'PRO', CHAMPIONSHIP: 'PRO',
      TROPHY_SHELF: 'PRO', CUP_SETTINGS: 'PRO', PAST_YEARS: 'PRO', ALL_TIME_SUMMARY: 'PLATINUM', RECORD_BOOK: 'PLATINUM',
    },
  } satisfies Extract<SettingsGroup, { key: 'PLAN_CONFIG' }>['value'];

  beforeEach(() => {
    listSettingsGroupsMock.mockReset();
    listSettingsGroupsMock.mockResolvedValue({
      data: {
        groups: [{
          key: 'PLAN_CONFIG',
          title: 'Plans',
          description: 'What each league plan allows: its caps, and the plan each feature starts at.',
          source: 'defaults',
          updatedAt: null,
          updatedBy: null,
          value: PLAN_DEFAULTS,
          defaults: PLAN_DEFAULTS,
        } satisfies SettingsGroup],
      },
    });
  });

  it('lists each cap\'s limit on every plan, Free to Platinum, Platinum\'s included', async () => {
    renderPage();

    const card = within(await screen.findByTestId('root-admin-settings-group-PLAN_CONFIG'));
    expect(card.getByText('Entries per contest')).toBeInTheDocument();
    expect(card.getByText('Free 20 · Pro 50 · Premium Unlimited · Platinum Unlimited')).toBeInTheDocument();
    expect(card.getByText('Sports leagues a year')).toBeInTheDocument();
    expect(card.getByText('Free 5 · Pro 15 · Premium 30 · Platinum 50')).toBeInTheDocument();
  });

  it('links the plans section to the Plans page, where the caps and features are edited', async () => {
    renderPage();

    expect(await screen.findByTestId('root-admin-settings-edit-PLAN_CONFIG')).toHaveAttribute('href', '/manage/plans');
  });
});

describe('RootAdminSettingsPage payments card', () => {
  beforeEach(() => {
    listSettingsGroupsMock.mockReset();
    listSettingsGroupHistoryMock.mockReset();
    updateSettingsGroupMock.mockReset();
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [DEFAULT_BILLING] } });
  });

  it('says payments are off, so expanding is free, and lists each plan\'s sizes with their prices', async () => {
    renderPage();

    const card = within(await screen.findByTestId('root-admin-settings-group-BILLING_CONFIG'));
    expect(card.getByText('Off: expanding a contest is free')).toBeInTheDocument();
    expect(card.getByText('50 entries $10 · 100 entries $20')).toBeInTheDocument();
    expect(card.getByText('100 entries $15')).toBeInTheDocument();
    expect(card.getByText('None')).toBeInTheDocument();
  });

  it('saves a changed price and an added size in cents, keeping payments off and the plan prices as stored, with the version it was read at', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_BILLING });
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-billing-FREE-price-1'), { target: { value: '22.5' } });
    fireEvent.click(screen.getByTestId('root-admin-billing-PREMIUM-add'));
    fireEvent.change(screen.getByTestId('root-admin-billing-PREMIUM-entries-0'), { target: { value: '200' } });
    fireEvent.change(screen.getByTestId('root-admin-billing-PREMIUM-price-0'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('root-admin-billing-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    expect(updateSettingsGroupMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      path: { key: 'BILLING_CONFIG' },
      body: {
        key: 'BILLING_CONFIG',
        expectedUpdatedAt: null,
        value: {
          paymentsEnabled: false,
          planPrices: PLAN_PRICES,
          expansionPrices: {
            FREE: [{ entriesPerContest: 50, priceCents: 1000 }, { entriesPerContest: 100, priceCents: 2250 }],
            PRO: [{ entriesPerContest: 100, priceCents: 1500 }],
            PREMIUM: [{ entriesPerContest: 200, priceCents: 1500 }],
            PLATINUM: [{ entriesPerContest: 1000, priceCents: 3000 }],
          },
        },
      },
    }));
  });

  it('refuses to save a size left blank, without sending anything', async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-billing-PREMIUM-add'));
    fireEvent.click(screen.getByTestId('root-admin-billing-settings-save'));

    expect(await screen.findByText('Enter a number of entries.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('says a size or price is out of range, rather than asking for a number the admin did enter', async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-billing-PREMIUM-add'));
    fireEvent.change(screen.getByTestId('root-admin-billing-PREMIUM-entries-0'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('root-admin-billing-PREMIUM-price-0'), { target: { value: '20000' } });
    fireEvent.click(screen.getByTestId('root-admin-billing-settings-save'));

    expect(await screen.findByText('At least 1 entry.')).toBeInTheDocument();
    expect(screen.getByText('At most $10,000.')).toBeInTheDocument();
    expect(screen.queryByText('Enter a number of entries.')).not.toBeInTheDocument();
    expect(screen.queryByText('Enter a price.')).not.toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason when the sizes do not rise down a list', async () => {
    updateSettingsGroupMock.mockResolvedValue({
      error: { error: { code: 'VALIDATION_ERROR', message: 'Each Free size must be larger than the one above it.' } },
      status: 400,
    });
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-billing-FREE-entries-1'), { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('root-admin-billing-settings-save'));

    expect(await screen.findByTestId('root-admin-billing-settings-error')).toHaveTextContent('Each Free size must be larger than the one above it.');
  });
});
