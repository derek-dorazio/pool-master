import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsChange, SettingsGroup } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { budgetPricingGroupFixture } from './sport-test-fixtures';
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
  perSportOverrides: {},
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
    EVENT_COMING_UP: true,
    EVENT_READY_FOR_CONTESTS: true,
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
    renderPage();

    const ingestion = within(await screen.findByTestId('root-admin-settings-group-INGESTION_SCHEDULE_CONFIG'));
    const email = within(screen.getByTestId('root-admin-settings-group-EMAIL_CONFIG'));

    expect(ingestion.getByText('Saved')).toBeInTheDocument();
    expect(ingestion.getByText('Every 45 s')).toBeInTheDocument();
    expect(ingestion.getByTestId('root-admin-settings-last-change-INGESTION_SCHEDULE_CONFIG')).toHaveTextContent('Last changed by Ada Admin');
    expect(email.getByText('Defaults')).toBeInTheDocument();
    expect(email.getByText('Never changed: using the defaults.')).toBeInTheDocument();
  });

  it('links the ingestion schedule section to its edit page under Settings', async () => {
    renderPage();

    expect(await screen.findByTestId('root-admin-settings-edit-INGESTION_SCHEDULE_CONFIG'))
      .toHaveAttribute('href', '/manage/settings/ingestion-schedule');
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

    expect(await screen.findByTestId('shared-error-state')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-settings-group-INGESTION_SCHEDULE_CONFIG')).not.toBeInTheDocument();
  });
});

describe('RootAdminSettingsPage email card', () => {
  beforeEach(() => {
    listSettingsGroupsMock.mockReset();
    listSettingsGroupHistoryMock.mockReset();
    updateSettingsGroupMock.mockReset();
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [DEFAULT_EMAIL] } });
  });

  it('saves email switched off with one template off and an allow list, sending the version it was read at', async () => {
    updateSettingsGroupMock.mockImplementation(({ body }: { body: { value: typeof EMAIL_DEFAULTS } }) => Promise.resolve({
      data: { ...DEFAULT_EMAIL, source: 'stored', updatedAt: '2026-10-07T13:00:00.000Z', updatedBy: ADMIN, value: body.value },
    }));
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-email-settings-template-CONTEST_STARTED_SUMMARY'));
    fireEvent.change(screen.getByTestId('root-admin-email-settings-allowed-recipients'), { target: { value: 'tester@gmail.com' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-enabled'));
    expect(screen.getByTestId('root-admin-email-settings-off-warning')).toHaveTextContent('No system email is sent');
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    expect(updateSettingsGroupMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      path: { key: 'EMAIL_CONFIG' },
      body: {
        key: 'EMAIL_CONFIG',
        expectedUpdatedAt: null,
        value: {
          enabled: false,
          allowedRecipients: ['tester@gmail.com'],
          sendRatePerSecond: 10,
          entryReminderHours: [48, 24, 3],
          standingsBufferMinutes: 30,
          templates: { ...EMAIL_DEFAULTS.templates, CONTEST_STARTED_SUMMARY: false },
        },
      },
    }));
  });

  it('saves the allow list one address or @domain per line, lowercased, skipping blank lines', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-email-settings-allowed-recipients'), {
      target: { value: 'Derek+Alice@Gmail.com\n\n  @simulator.amazonses.com  \n' },
    });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: { allowedRecipients: string[] } } }];
    expect(request.body.value.allowedRecipients).toEqual(['derek+alice@gmail.com', '@simulator.amazonses.com']);
  });

  it('saves the send rate as a number', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-email-settings-send-rate'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: { sendRatePerSecond: number } } }];
    expect(request.body.value.sendRatePerSecond).toBe(5);
  });

  it('refuses to save a send rate below one email a second', async () => {
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-email-settings-send-rate'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    expect(await screen.findByText(/greater than or equal to 1/)).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('saves the standings email delay as a number of minutes', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
    renderPage();

    const field = await screen.findByTestId('root-admin-email-settings-standings-buffer');
    expect(field).toHaveValue(30);
    fireEvent.change(field, { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: { standingsBufferMinutes: number } } }];
    expect(request.body.value.standingsBufferMinutes).toBe(45);
  });

  it('refuses to save a standings email delay over 240 minutes', async () => {
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-email-settings-standings-buffer'), { target: { value: '300' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    expect(await screen.findByText(/less than or equal to 240/)).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('saves the entry reminder hours typed with commas as a list of numbers', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
    renderPage();

    const field = await screen.findByTestId('root-admin-email-settings-reminder-hours');
    expect(field).toHaveValue('48, 24, 3');
    fireEvent.change(field, { target: { value: '72, 24,, 2 ' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: { entryReminderHours: number[] } } }];
    expect(request.body.value.entryReminderHours).toEqual([72, 24, 2]);
  });

  it('refuses to save entry reminder hours that are not whole numbers from 1 to 168', async () => {
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-email-settings-reminder-hours'), { target: { value: '48, soon' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    expect(await screen.findByText('List 1 to 5 whole numbers of hours from 1 to 168, separated by commas.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('shows the saved allow list one per line', async () => {
    listSettingsGroupsMock.mockResolvedValue({
      data: { groups: [{ ...DEFAULT_EMAIL, value: { ...EMAIL_DEFAULTS, allowedRecipients: ['a@gmail.com', '@b.com'] } }] },
    });
    renderPage();

    expect(await screen.findByTestId('root-admin-email-settings-allowed-recipients')).toHaveValue('a@gmail.com\n@b.com');
  });

  it('refuses to save an allow list line that is not an address or @domain, naming the line', async () => {
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-email-settings-allowed-recipients'), {
      target: { value: 'a@gmail.com\ngmail.com' },
    });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    expect(await screen.findByText('"gmail.com" is not an email address or @domain.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('when another admin saved first, loads their newer settings on request and saves against that newer version', async () => {
    const theirs: SettingsGroup = {
      ...DEFAULT_EMAIL,
      source: 'stored',
      updatedAt: '2026-10-07T14:00:00.000Z',
      updatedBy: ADMIN,
      value: { ...EMAIL_DEFAULTS, allowedRecipients: ['theirs@gmail.com'] },
    };
    updateSettingsGroupMock.mockResolvedValueOnce({
      error: { error: { code: 'SETTINGS_CONFLICT', message: 'Settings group EMAIL_CONFIG was changed by someone else; reload and try again.' } },
    });
    updateSettingsGroupMock.mockResolvedValueOnce({ data: theirs });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-email-settings-enabled'));
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    const error = await screen.findByTestId('root-admin-email-settings-error');
    expect(error).toHaveTextContent('changed by someone else');
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [theirs] } });
    fireEvent.click(within(error).getByRole('button', { name: 'Load the latest settings' }));

    await waitFor(() => expect(screen.getByTestId('root-admin-email-settings-allowed-recipients')).toHaveValue('theirs@gmail.com'));
    expect(screen.queryByTestId('root-admin-email-settings-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-email-settings-enabled')).toBeChecked();
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(2));
    const [retry] = updateSettingsGroupMock.mock.calls[1] as [{ body: { expectedUpdatedAt: string | null } }];
    expect(retry.body.expectedUpdatedAt).toBe('2026-10-07T14:00:00.000Z');
  });
});

describe('RootAdminSettingsPage budget pricing card (#93)', () => {
  beforeEach(() => {
    listSettingsGroupsMock.mockReset();
    listSettingsGroupHistoryMock.mockReset();
    updateSettingsGroupMock.mockReset();
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [budgetPricingGroupFixture()] } });
  });

  it('lists each profile with its values, the default first', async () => {
    renderPage();

    const card = within(await screen.findByTestId('root-admin-settings-group-BUDGET_PRICING_CONFIG'));
    expect(card.getByText('Standard (default)')).toBeInTheDocument();
    expect(card.getByText('$50,000 cap · $100 unit · best 24% · worst 12% · steepness 4')).toBeInTheDocument();
    expect(card.getByText('$5,000 cap · $10 unit · best 24% · worst 12% · steepness 4')).toBeInTheDocument();
  });

  it('saves a changed profile and an added one, with the version it was read at', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: budgetPricingGroupFixture() });
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-budget-pricing-topSharePercent-1'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('root-admin-budget-pricing-add'));
    fireEvent.change(screen.getByTestId('root-admin-budget-pricing-name-2'), { target: { value: 'Big' } });
    fireEvent.change(screen.getByTestId('root-admin-budget-pricing-salaryCap-2'), { target: { value: '100000' } });
    fireEvent.click(screen.getByTestId('root-admin-budget-pricing-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    expect(updateSettingsGroupMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      path: { key: 'BUDGET_PRICING_CONFIG' },
      body: {
        key: 'BUDGET_PRICING_CONFIG',
        expectedUpdatedAt: null,
        value: {
          profiles: [
            { name: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
            { name: 'Small', salaryCap: 5000, unit: 10, topSharePercent: 30, floorSharePercent: 12, steepness: 4 },
            { name: 'Big', salaryCap: 100000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
          ],
        },
      },
    }));
  });

  it('refuses to save two profiles with one name, or a worst-golfer share above the best', async () => {
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-budget-pricing-name-1'), { target: { value: 'standard' } });
    fireEvent.change(screen.getByTestId('root-admin-budget-pricing-floorSharePercent-0'), { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('root-admin-budget-pricing-settings-save'));

    expect(await screen.findByText('Another profile already has this name.')).toBeInTheDocument();
    expect(screen.getByText('The worst seed\'s share can\'t be above the best seed\'s.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });
});
