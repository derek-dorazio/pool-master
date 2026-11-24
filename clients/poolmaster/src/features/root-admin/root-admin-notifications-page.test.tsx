import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsGroup, SystemEmailDto, UserDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { AuthContext } from '@/features/auth/auth-context';
import { dismissAllToasts, Toaster } from '@/features/shared/ui';
import { RootAdminNotificationsPage } from './root-admin-notifications-page';

const {
  getSettingsGroupMock,
  getSystemEmailLatestSendMock,
  listSystemEmailsMock,
  sendSystemEmailLatestSendToMeMock,
  sendTestEmailMock,
  updateSettingsGroupMock,
} = vi.hoisted(() => ({
  getSettingsGroupMock: vi.fn(),
  getSystemEmailLatestSendMock: vi.fn(),
  listSystemEmailsMock: vi.fn(),
  sendSystemEmailLatestSendToMeMock: vi.fn(),
  sendTestEmailMock: vi.fn(),
  updateSettingsGroupMock: vi.fn(),
}));

bindApiMocks({
  getSettingsGroup: getSettingsGroupMock,
  getSystemEmailLatestSend: getSystemEmailLatestSendMock,
  listSystemEmails: listSystemEmailsMock,
  sendSystemEmailLatestSendToMe: sendSystemEmailLatestSendToMeMock,
  sendTestEmail: sendTestEmailMock,
  updateSettingsGroup: updateSettingsGroupMock,
});

const ADMIN = { id: '6f7c1c55-58a4-4bd4-8a2a-0b8e3f1f4a01', name: 'Ada Admin' };

const ME: UserDto = {
  id: ADMIN.id,
  email: 'ada@example.com',
  username: 'ada',
  firstName: 'Ada',
  lastName: 'Admin',
  isActive: true,
  isRootAdmin: true,
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

const RESULTS: SystemEmailDto = {
  templateKey: 'CONTEST_RESULTS',
  planFeature: 'EMAIL_CONTEST_RESULTS',
  planStartsAt: 'FREE',
  status: 'ON',
  sentLast30Days: 42,
  lastSentAt: '2026-11-18T12:00:00.000Z',
  previewSentAt: '2026-11-18T12:00:00.000Z',
};

const STANDINGS_OFF: SystemEmailDto = {
  templateKey: 'CONTEST_STANDINGS',
  planFeature: 'EMAIL_CONTEST_STANDINGS',
  planStartsAt: 'PRO',
  status: 'OFF',
  sentLast30Days: 0,
  lastSentAt: null,
  previewSentAt: null,
};

const PASSWORD_RESET: SystemEmailDto = {
  templateKey: 'PASSWORD_RESET',
  planFeature: null,
  planStartsAt: null,
  status: 'ALWAYS_ON',
  sentLast30Days: 3,
  lastSentAt: '2026-11-17T09:00:00.000Z',
  previewSentAt: null,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ isAuthenticated: true, isLoading: false, isRootAdmin: true, user: ME, clearSession: () => Promise.resolve() }}>
        <MemoryRouter>
          <RootAdminNotificationsPage />
          <Toaster />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

async function openEmail(templateKey: string) {
  const row = await screen.findByTestId(`root-admin-system-email-${templateKey}`);
  fireEvent.click(within(row).getByTestId('data-grid-row-opens-dialog'));
  return screen.findByTestId('root-admin-system-email-dialog');
}

/** Opens ⚙ Email settings once the settings have loaded, which is when its button enables. */
async function openEmailSettings() {
  const open = await screen.findByTestId('root-admin-email-settings-open');
  await waitFor(() => expect(open).toBeEnabled());
  fireEvent.click(open);
  return screen.findByTestId('root-admin-email-settings-dialog');
}

async function openEmailSettingsEdit() {
  fireEvent.click(within(await openEmailSettings()).getByTestId('root-admin-email-settings-dialog-edit'));
}

function footerButtons(dialog: HTMLElement): string[] {
  return within(dialog).getAllByRole('button').map((button) => button.textContent).filter((text) => text !== '' && text !== 'Close dialog');
}

beforeEach(() => {
  getSettingsGroupMock.mockReset();
  getSystemEmailLatestSendMock.mockReset();
  listSystemEmailsMock.mockReset();
  sendSystemEmailLatestSendToMeMock.mockReset();
  sendTestEmailMock.mockReset();
  updateSettingsGroupMock.mockReset();
  getSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
  listSystemEmailsMock.mockResolvedValue({ data: { emails: [RESULTS, STANDINGS_OFF, PASSWORD_RESET] } });
});

afterEach(() => {
  dismissAllToasts();
});

describe('Notifications page: the Emails grid', () => {
  it('lists each system email with its name, audience, when it goes, plan, status and sends of the last 30 days', async () => {
    renderPage();

    const results = within(await screen.findByTestId('root-admin-system-email-CONTEST_RESULTS'));
    expect(results.getByText('Final results')).toBeInTheDocument();
    expect(results.getByText('Members')).toBeInTheDocument();
    expect(results.getByText('A contest is settled')).toBeInTheDocument();
    expect(results.getByText('Free')).toBeInTheDocument();
    expect(results.getByText('On')).toBeInTheDocument();
    expect(results.getByText('42')).toBeInTheDocument();
    const reset = within(screen.getByTestId('root-admin-system-email-PASSWORD_RESET'));
    expect(reset.getByText('Every plan')).toBeInTheDocument();
    expect(reset.getByText('Always on')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-system-email-CONTEST_STANDINGS')).getByText('Off')).toBeInTheDocument();
  });

  it('shows an error state, not sample rows, when the emails cannot load', async () => {
    listSystemEmailsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'down' } }, status: 500 });
    renderPage();

    expect(await screen.findByTestId('root-admin-system-emails-state-error')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-system-email-CONTEST_RESULTS')).not.toBeInTheDocument();
  });
});

describe('Notifications page: an email\'s dialog', () => {
  it('opens in view with its audience, when, plan, status and sends, and Close · Preview · Send me this email · Edit', async () => {
    renderPage();

    const dialog = await openEmail('CONTEST_RESULTS');

    expect(within(dialog).getByTestId('root-admin-system-email-dialog-audience')).toHaveTextContent('Members');
    expect(within(dialog).getByTestId('root-admin-system-email-dialog-when')).toHaveTextContent('A contest is settled');
    expect(within(dialog).getByTestId('root-admin-system-email-dialog-plan')).toHaveTextContent('Free');
    expect(within(dialog).getByTestId('root-admin-system-email-dialog-status')).toHaveTextContent('On');
    expect(within(dialog).getByTestId('root-admin-system-email-dialog-sent')).toHaveTextContent('42');
    expect(footerButtons(dialog)).toEqual(['Close', 'Preview', 'Send me this email', 'Edit']);
  });

  it('previews the latest send in its own dialog, its HTML in a sandboxed frame, and Close comes back to the email', async () => {
    getSystemEmailLatestSendMock.mockResolvedValue({
      data: {
        templateKey: 'CONTEST_RESULTS',
        subject: 'Final results: Masters Pool',
        htmlBody: '<html><body><p>You finished 2nd</p></body></html>',
        sentAt: '2026-11-18T12:00:00.000Z',
        recipient: 'j•••@example.com',
      },
    });
    renderPage();

    fireEvent.click(within(await openEmail('CONTEST_RESULTS')).getByTestId('root-admin-system-email-dialog-preview'));

    const preview = await screen.findByTestId('root-admin-system-email-preview');
    expect(preview).toHaveTextContent('Final results · Preview · sent');
    expect(await within(preview).findByTestId('root-admin-system-email-preview-subject')).toHaveTextContent('Final results: Masters Pool');
    expect(within(preview).getByTestId('root-admin-system-email-preview-recipient')).toHaveTextContent('j•••@example.com');
    const frame = within(preview).getByTestId('root-admin-system-email-preview-frame');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('srcdoc', '<html><body><p>You finished 2nd</p></body></html>');
    expect(footerButtons(preview)).toEqual(['Close']);
    expect(getSystemEmailLatestSendMock.mock.calls[0][0]).toEqual(expect.objectContaining({ path: { templateKey: 'CONTEST_RESULTS' } }));

    fireEvent.click(within(preview).getByRole('button', { name: 'Close' }));

    expect(await screen.findByTestId('root-admin-system-email-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-system-email-preview')).not.toBeInTheDocument();
  });

  it('sends the admin a copy of the latest send and says it is waiting to be sent', async () => {
    sendSystemEmailLatestSendToMeMock.mockResolvedValue({ data: { status: 'QUEUED', skipReason: null } });
    renderPage();

    fireEvent.click(within(await openEmail('CONTEST_RESULTS')).getByTestId('root-admin-system-email-dialog-send-to-me'));

    expect(await screen.findByText('Waiting to be sent. Check your inbox in a few minutes.')).toBeInTheDocument();
    expect(sendSystemEmailLatestSendToMeMock.mock.calls[0][0]).toEqual(expect.objectContaining({ path: { templateKey: 'CONTEST_RESULTS' } }));
  });

  it('says why a copy was skipped, such as the admin\'s address not in "Only send to"', async () => {
    sendSystemEmailLatestSendToMeMock.mockResolvedValue({ data: { status: 'SKIPPED', skipReason: 'NOT_ALLOWED_IN_ENVIRONMENT' } });
    renderPage();

    fireEvent.click(within(await openEmail('CONTEST_RESULTS')).getByTestId('root-admin-system-email-dialog-send-to-me'));

    expect(await screen.findByText('Not sent: the address is not in "Only send to", or is a reserved test domain.')).toBeInTheDocument();
  });

  it('disables Preview and Send me this email with a Not sent yet note for an email never sent', async () => {
    renderPage();

    const dialog = await openEmail('CONTEST_STANDINGS');

    expect(within(dialog).getByTestId('root-admin-system-email-dialog-preview')).toBeDisabled();
    expect(within(dialog).getByTestId('root-admin-system-email-dialog-send-to-me')).toBeDisabled();
    expect(within(dialog).getByTestId('root-admin-system-email-dialog-not-sent')).toHaveTextContent('Not sent yet');
  });

  it('gives an Always on email no Edit, and says its sends keep no content to preview', async () => {
    renderPage();

    const dialog = await openEmail('PASSWORD_RESET');

    expect(footerButtons(dialog)).toEqual(['Close', 'Preview', 'Send me this email']);
    expect(within(dialog).getByTestId('root-admin-system-email-dialog-not-sent')).toHaveTextContent('None kept from the last 30 days');
  });

  it('Edit switches the email off through its switch in the email settings, sending the version it was read at, then shows the view', async () => {
    updateSettingsGroupMock.mockImplementation(({ body }: { body: { value: typeof EMAIL_DEFAULTS } }) => Promise.resolve({
      data: { ...DEFAULT_EMAIL, source: 'stored', updatedAt: '2026-11-19T13:00:00.000Z', updatedBy: ADMIN, value: body.value },
    }));
    renderPage();

    const dialog = await openEmail('CONTEST_RESULTS');
    fireEvent.click(within(dialog).getByTestId('root-admin-system-email-dialog-edit'));
    expect(within(dialog).getByText('Final results · Edit')).toBeInTheDocument();
    const status = within(dialog).getByTestId('root-admin-system-email-dialog-status-on');
    expect(status).toBeChecked();
    fireEvent.click(status);
    fireEvent.click(within(dialog).getByTestId('root-admin-system-email-dialog-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    expect(updateSettingsGroupMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      path: { key: 'EMAIL_CONFIG' },
      body: {
        key: 'EMAIL_CONFIG',
        expectedUpdatedAt: null,
        value: { ...EMAIL_DEFAULTS, templates: { ...EMAIL_DEFAULTS.templates, CONTEST_RESULTS: false } },
      },
    }));
    expect(await within(dialog).findByTestId('root-admin-system-email-dialog-audience')).toBeInTheDocument();
  });

  it('Cancel leaves the edit unsaved and goes back to the view', async () => {
    renderPage();

    const dialog = await openEmail('CONTEST_RESULTS');
    fireEvent.click(within(dialog).getByTestId('root-admin-system-email-dialog-edit'));
    fireEvent.click(within(dialog).getByTestId('root-admin-system-email-dialog-status-on'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(within(dialog).getByTestId('root-admin-system-email-dialog-status')).toHaveTextContent('On');
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });
});

describe('Notifications page: Email settings', () => {
  it('opens in view with the settings every email obeys and who last changed them, and Close · Check delivery · Edit', async () => {
    getSettingsGroupMock.mockResolvedValue({
      data: { ...DEFAULT_EMAIL, source: 'stored', updatedAt: '2026-11-18T12:00:00.000Z', updatedBy: ADMIN, value: { ...EMAIL_DEFAULTS, allowedRecipients: ['@example.com'] } },
    });
    renderPage();

    const dialog = await openEmailSettings();

    expect(within(dialog).getByTestId('root-admin-email-settings-dialog-enabled')).toHaveTextContent('On');
    expect(within(dialog).getByTestId('root-admin-email-settings-dialog-allowedRecipients')).toHaveTextContent('@example.com');
    expect(within(dialog).getByTestId('root-admin-email-settings-dialog-sendRatePerSecond')).toHaveTextContent('10');
    expect(within(dialog).getByTestId('root-admin-email-settings-dialog-entryReminderHours')).toHaveTextContent('48, 24, 3 hours before picks close');
    expect(within(dialog).getByTestId('root-admin-email-settings-dialog-standingsBufferMinutes')).toHaveTextContent('30 minutes');
    expect(within(dialog).getByTestId('root-admin-email-settings-dialog-weeklyDigestHour')).toHaveTextContent('Mondays at 3:00 AM Eastern');
    expect(within(dialog).getByTestId('root-admin-email-settings-dialog-last-changed')).toHaveTextContent('Ada Admin on');
    expect(footerButtons(dialog)).toEqual(['Close', 'Check delivery', 'Edit']);
  });

  it('Check delivery sends the test email to the admin\'s own address and says how it went', async () => {
    sendTestEmailMock.mockResolvedValue({ data: { status: 'SENT', skipReason: null, error: null } });
    renderPage();

    fireEvent.click(within(await openEmailSettings()).getByTestId('root-admin-email-settings-dialog-check-delivery'));

    expect(await screen.findByText('Sent. Check your inbox in a minute.')).toBeInTheDocument();
    expect(sendTestEmailMock.mock.calls[0][0]).toEqual(expect.objectContaining({ body: { to: 'ada@example.com' } }));
  });

  it('Check delivery says when email is switched off', async () => {
    sendTestEmailMock.mockResolvedValue({ data: { status: 'SKIPPED', skipReason: 'EMAIL_DISABLED', error: null } });
    renderPage();

    fireEvent.click(within(await openEmailSettings()).getByTestId('root-admin-email-settings-dialog-check-delivery'));

    expect(await screen.findByText('Not sent: "Send system email" is off. Turn it on in Email settings first.')).toBeInTheDocument();
  });

  it('Check delivery passes on what the email provider said about a failed send', async () => {
    sendTestEmailMock.mockResolvedValue({ data: { status: 'FAILED', skipReason: null, error: 'Email address is not verified.' } });
    renderPage();

    fireEvent.click(within(await openEmailSettings()).getByTestId('root-admin-email-settings-dialog-check-delivery'));

    expect(await screen.findByText('Not sent. The email provider said: Email address is not verified.')).toBeInTheDocument();
  });

  it('saves email switched off and an allow list, keeping each email\'s own switch, sending the version it was read at', async () => {
    updateSettingsGroupMock.mockImplementation(({ body }: { body: { value: typeof EMAIL_DEFAULTS } }) => Promise.resolve({
      data: { ...DEFAULT_EMAIL, source: 'stored', updatedAt: '2026-10-07T13:00:00.000Z', updatedBy: ADMIN, value: body.value },
    }));
    renderPage();

    await openEmailSettingsEdit();
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
          weeklyDigestHour: 3,
          templates: EMAIL_DEFAULTS.templates,
        },
      },
    }));
  });

  it('saves the allow list one address or @domain per line, lowercased, skipping blank lines', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
    renderPage();
    await openEmailSettingsEdit();

    fireEvent.change(screen.getByTestId('root-admin-email-settings-allowed-recipients'), {
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
    await openEmailSettingsEdit();

    fireEvent.change(screen.getByTestId('root-admin-email-settings-send-rate'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: { sendRatePerSecond: number } } }];
    expect(request.body.value.sendRatePerSecond).toBe(5);
  });

  it('refuses to save a send rate below one email a second', async () => {
    renderPage();
    await openEmailSettingsEdit();

    fireEvent.change(screen.getByTestId('root-admin-email-settings-send-rate'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    expect(await screen.findByText('From 1 to 100 emails a second.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('says a send rate must be whole when it is a fraction inside the range', async () => {
    renderPage();
    await openEmailSettingsEdit();

    fireEvent.change(screen.getByTestId('root-admin-email-settings-send-rate'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    expect(await screen.findByText('Whole emails a second only.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('saves the standings email delay as a number of minutes', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
    renderPage();
    await openEmailSettingsEdit();

    const field = screen.getByTestId('root-admin-email-settings-standings-buffer');
    expect(field).toHaveValue(30);
    fireEvent.change(field, { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: { standingsBufferMinutes: number } } }];
    expect(request.body.value.standingsBufferMinutes).toBe(45);
  });

  it('saves the weekly event digest hour, and refuses one past 23', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
    renderPage();
    await openEmailSettingsEdit();

    const field = screen.getByTestId('root-admin-email-settings-digest-hour');
    expect(field).toHaveValue(3);
    fireEvent.change(field, { target: { value: '24' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));
    expect(await screen.findByText('An hour from 0 to 23.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));
    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: { weeklyDigestHour: number } } }];
    expect(request.body.value.weeklyDigestHour).toBe(5);
  });

  it('refuses to save a standings email delay over 240 minutes', async () => {
    renderPage();
    await openEmailSettingsEdit();

    fireEvent.change(screen.getByTestId('root-admin-email-settings-standings-buffer'), { target: { value: '300' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    expect(await screen.findByText('From 0 to 240 minutes.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('saves the entry reminder hours typed with commas as a list of numbers', async () => {
    updateSettingsGroupMock.mockResolvedValue({ data: DEFAULT_EMAIL });
    renderPage();
    await openEmailSettingsEdit();

    const field = screen.getByTestId('root-admin-email-settings-reminder-hours');
    expect(field).toHaveValue('48, 24, 3');
    fireEvent.change(field, { target: { value: '72, 24,, 2 ' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: { entryReminderHours: number[] } } }];
    expect(request.body.value.entryReminderHours).toEqual([72, 24, 2]);
  });

  it('refuses to save entry reminder hours that are not whole numbers from 1 to 168', async () => {
    renderPage();
    await openEmailSettingsEdit();

    fireEvent.change(screen.getByTestId('root-admin-email-settings-reminder-hours'), { target: { value: '48, soon' } });
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    expect(await screen.findByText('List 1 to 5 whole numbers of hours from 1 to 168, separated by commas.')).toBeInTheDocument();
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('shows the saved allow list one per line', async () => {
    getSettingsGroupMock.mockResolvedValue({ data: { ...DEFAULT_EMAIL, value: { ...EMAIL_DEFAULTS, allowedRecipients: ['a@gmail.com', '@b.com'] } } });
    renderPage();
    await openEmailSettingsEdit();

    expect(screen.getByTestId('root-admin-email-settings-allowed-recipients')).toHaveValue('a@gmail.com\n@b.com');
  });

  it('refuses to save an allow list line that is not an address or @domain, naming the line', async () => {
    renderPage();
    await openEmailSettingsEdit();

    fireEvent.change(screen.getByTestId('root-admin-email-settings-allowed-recipients'), {
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
    await openEmailSettingsEdit();

    fireEvent.click(screen.getByTestId('root-admin-email-settings-enabled'));
    fireEvent.click(screen.getByTestId('root-admin-email-settings-save'));

    const error = await screen.findByTestId('root-admin-email-settings-error');
    expect(error).toHaveTextContent('Someone else changed these settings.');
    getSettingsGroupMock.mockResolvedValue({ data: theirs });
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
