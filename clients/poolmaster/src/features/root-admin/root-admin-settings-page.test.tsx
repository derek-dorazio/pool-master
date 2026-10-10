import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  replyTo: null,
  templates: {
    LEAGUE_MEMBER_INVITE: true,
    LEAGUE_JOIN_SUCCESS: true,
    CONTEST_ENTRY_COMPLETED: true,
    CONTEST_STARTED_SUMMARY: true,
  },
};

const DEFAULT_EMAIL: SettingsGroup = {
  key: 'EMAIL_CONFIG',
  title: 'Email',
  description: 'Whether system email is sent, which emails, and their Reply-To address.',
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

  it('saves email switched off with one template off and a Reply-To, sending the version it was read at', async () => {
    updateSettingsGroupMock.mockImplementation(({ body }: { body: { value: typeof EMAIL_DEFAULTS } }) => Promise.resolve({
      data: { ...DEFAULT_EMAIL, source: 'stored', updatedAt: '2026-10-07T13:00:00.000Z', updatedBy: ADMIN, value: body.value },
    }));
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-email-settings-template-CONTEST_STARTED_SUMMARY'));
    fireEvent.change(screen.getByTestId('root-admin-email-settings-reply-to'), { target: { value: 'support@example.com' } });
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
          replyTo: 'support@example.com',
          templates: { ...EMAIL_DEFAULTS.templates, CONTEST_STARTED_SUMMARY: false },
        },
      },
    }));
  });

  it('saves a blank Reply-To as none', async () => {
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [{ ...DEFAULT_EMAIL, value: { ...EMAIL_DEFAULTS, replyTo: 'old@example.com' } }] } });
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-email-settings-reply-to'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: { replyTo: string | null } } }];
    expect(request.body.value.replyTo).toBeNull();
  });

  it('refuses to save a Reply-To that is not an email address', async () => {
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-email-settings-reply-to'), { target: { value: 'not an address' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    expect(await screen.findByText('Enter an email address, or leave it blank.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('when another admin saved first, loads their newer settings on request and saves against that newer version', async () => {
    const theirs: SettingsGroup = {
      ...DEFAULT_EMAIL,
      source: 'stored',
      updatedAt: '2026-10-07T14:00:00.000Z',
      updatedBy: ADMIN,
      value: { ...EMAIL_DEFAULTS, replyTo: 'theirs@example.com' },
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

    await waitFor(() => expect(screen.getByTestId('root-admin-email-settings-reply-to')).toHaveValue('theirs@example.com'));
    expect(screen.queryByTestId('root-admin-email-settings-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-email-settings-enabled')).toBeChecked();
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(2));
    const [retry] = updateSettingsGroupMock.mock.calls[1] as [{ body: { expectedUpdatedAt: string | null } }];
    expect(retry.body.expectedUpdatedAt).toBe('2026-10-07T14:00:00.000Z');
  });
});
