import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IngestionSchedule, IngestionScheduleConfig, ProviderSummaryDto, SettingsGroup } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminProvidersPage } from './root-admin-providers-page';
import { providerSettingsFixture, providerSummaryFixture } from './sport-test-fixtures';

// /manage/providers: the providers grid with each provider's view-only dialog and its Check now,
// and the sync schedules grid with each sync's view-then-Edit dialog.

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  getSettingsGroup: vi.fn(),
  getIngestionSchedule: vi.fn(),
  updateProviderSettings: vi.fn(),
  updateProviderLeague: vi.fn(),
  updateIngestionSchedule: vi.fn(),
}));

bindApiMocks(mocks);

function provider(overrides: Partial<ProviderSummaryDto> = {}): ProviderSummaryDto {
  return providerSummaryFixture({ sportsCovered: ['GOLF'], primaryForSports: ['GOLF'], ...overrides });
}

const SCHEDULE: IngestionScheduleConfig = {
  EVENTS: { enabled: true, intervalMinutes: 360 },
  FIELD: { intervalMinutes: 360, lookaheadDays: 14 },
  SCORES: { enabled: true, intervalSeconds: 300 },
};

// The schedule as the API reads it (#2086): whether each sync runs and has a switch is the API's word.
const SCHEDULE_READ: IngestionSchedule = {
  EVENTS: { enabled: true, intervalMinutes: 360, runs: true, switchable: true },
  FIELD: { intervalMinutes: 360, lookaheadDays: 14, runs: true, switchable: false },
  SCORES: { enabled: true, intervalSeconds: 300, runs: true, switchable: true },
};
const EVENTS_OFF: IngestionSchedule = { ...SCHEDULE_READ, EVENTS: { enabled: false, intervalMinutes: 360, runs: false, switchable: true } };

function scheduleGroup(value: IngestionScheduleConfig = SCHEDULE, saved = true): SettingsGroup {
  return {
    key: 'INGESTION_SCHEDULE_CONFIG',
    title: 'Ingestion schedule',
    description: 'How often each sync runs.',
    source: saved ? 'stored' : 'defaults',
    updatedAt: saved ? '2026-11-12T15:00:00.000Z' : null,
    updatedBy: saved ? { id: '00000000-0000-4000-8000-000000000001', name: 'Derek' } : null,
    value,
    defaults: SCHEDULE,
  };
}

// The ranges the API holds each setting to; narrower than the API's own so a test proves the
// dialogs read them from the response rather than holding their own.
const settingRanges = {
  requestsPerMinute: { min: 2, max: 1000 },
  pollMinutes: { min: 1, max: 240 },
  priority: { min: 1, max: 100 },
  leagueMinutes: { min: 5, max: 600 },
};

function seed({ providers = [provider(), provider({ providerId: 'mock', providerName: 'Mock feed', status: 'DOWN', requestsPerMinute: null, webhooksEnabled: false, syncedSportLeagueCount: 0, rateLimitedJobsLast24h: 0, settings: null })], group = scheduleGroup(), schedule = SCHEDULE_READ } = {}) {
  mocks.listProviders.mockResolvedValue({ data: { providers, settingRanges } });
  mocks.getSettingsGroup.mockResolvedValue({ data: group });
  mocks.getIngestionSchedule.mockResolvedValue({ data: schedule });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/providers']}>
        <RootAdminProvidersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminProvidersPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('counts the providers and how many are up in the header', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-providers-counts')).toHaveTextContent('2 providers · 1 up');
  });

  it('links Run event sync and Findings from the header, to their pages under Providers', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-open-run-event-sync-page')).toHaveAttribute('href', '/manage/providers/run-event-sync');
    expect(screen.getByTestId('root-admin-open-sync-findings-page')).toHaveAttribute('href', '/manage/providers/findings');
  });

  it('lists each provider with its status in a word, its request rate, sport leagues, error rate as a percent and rate-limited jobs of the last 24 hours, and no latency column', async () => {
    seed();
    renderPage();

    const balldontlie = within(await screen.findByTestId('root-admin-provider-balldontlie'));
    expect(balldontlie.getByText('BALLDONTLIE')).toBeInTheDocument();
    expect(balldontlie.getByText('Up')).toBeInTheDocument();
    expect(balldontlie.getByText('5')).toBeInTheDocument();
    expect(balldontlie.getByText('16')).toBeInTheDocument();
    expect(balldontlie.getByText('0.4%')).toBeInTheDocument();
    expect(balldontlie.getByText('7')).toBeInTheDocument();
    expect(screen.queryByText(/Latency/)).not.toBeInTheDocument();
    const mock = within(screen.getByTestId('root-admin-provider-mock'));
    expect(mock.getByText('Down')).toBeInTheDocument();
    expect(mock.getByText('Not paced')).toBeInTheDocument();
  });

  it('sorts Status by its own order, Up then Partly failing then Down, not by the words A to Z', async () => {
    seed({ providers: [
      provider({ providerId: 'down', providerName: 'Down feed', status: 'DOWN' }),
      provider({ providerId: 'up', providerName: 'Up feed', status: 'HEALTHY' }),
      provider({ providerId: 'slow', providerName: 'Slow feed', status: 'DEGRADED' }),
    ] });
    renderPage();

    await screen.findByTestId('root-admin-provider-down');
    await userEvent.click(screen.getByTestId('data-grid-sort-status'));
    const shown = screen.getAllByTestId(/^root-admin-provider-(up|slow|down)$/).map((row) => row.getAttribute('data-testid'));
    expect(shown).toEqual(['root-admin-provider-up', 'root-admin-provider-slow', 'root-admin-provider-down']);
  });

  it('opens a provider with its health from its runs and its settings, Close and Check now, and Check now checks the providers again', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-provider-balldontlie'));
    const dialog = within(await screen.findByTestId('root-admin-provider-dialog'));
    expect(dialog.getByTestId('root-admin-provider-dialog-webhooks')).toHaveTextContent('On');
    expect(dialog.getByText('0.4%')).toBeInTheDocument();
    expect(dialog.getByText('Rate limited (24 h)')).toBeInTheDocument();
    expect(dialog.getByTestId('root-admin-provider-dialog-base-url')).toHaveTextContent('https://api.balldontlie.io');
    expect(dialog.getByTestId('root-admin-provider-dialog-poll')).toHaveTextContent('15 minutes');
    expect(dialog.getByTestId('root-admin-provider-dialog-priority')).toHaveTextContent('1');
    expect(dialog.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    await userEvent.click(dialog.getByTestId('root-admin-provider-dialog-help'));
    expect(await screen.findByText(/stay in Secrets Manager/)).toBeInTheDocument();
    expect(mocks.listProviders).toHaveBeenCalledTimes(1);

    await userEvent.click(dialog.getByTestId('root-admin-provider-dialog-check'));

    await waitFor(() => expect(mocks.listProviders).toHaveBeenCalledTimes(2));
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('root-admin-provider-dialog')).not.toBeInTheDocument();
  });

  it('saves only the provider settings changed on Edit, then shows the view again', async () => {
    seed();
    mocks.updateProviderSettings.mockResolvedValue({ data: { provider: providerSettingsFixture({ requestsPerMinute: 600 }) } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-provider-balldontlie'));
    await userEvent.click(await screen.findByTestId('root-admin-provider-dialog-edit'));
    const rate = screen.getByTestId('root-admin-provider-dialog-rate-input');
    await userEvent.clear(rate);
    await userEvent.type(rate, '600');
    await userEvent.click(screen.getByTestId('root-admin-provider-dialog-save'));

    await waitFor(() => expect(mocks.updateProviderSettings).toHaveBeenCalledWith(expect.objectContaining({
      path: { providerId: providerSettingsFixture().id },
      body: { requestsPerMinute: 600 },
    })));
    expect(await screen.findByTestId('root-admin-provider-dialog-edit')).toBeInTheDocument();
  });

  it('keeps Save off for a rate outside the range the API holds it to', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-provider-balldontlie'));
    await userEvent.click(await screen.findByTestId('root-admin-provider-dialog-edit'));
    const rate = screen.getByTestId('root-admin-provider-dialog-rate-input');
    await userEvent.clear(rate);
    await userEvent.type(rate, '0');

    expect(await screen.findByText('Enter a whole number from 2 to 1000')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-provider-dialog-save')).toBeDisabled();
    expect(mocks.updateProviderSettings).not.toHaveBeenCalled();
  });

  it('shows a refused save, such as webhooks switched on without their secret, in the form, which stays open', async () => {
    seed({ providers: [provider({ webhooksEnabled: false, settings: providerSettingsFixture({ webhooksEnabled: false, webhookSecretSet: false }) })] });
    mocks.updateProviderSettings.mockResolvedValue({
      error: { error: { code: 'PROVIDER_WEBHOOK_SECRET_MISSING', message: 'BALLDONTLIE\'s webhook signing secret is not set in this environment.' } },
      response: { status: 422 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-provider-balldontlie'));
    expect(await screen.findByTestId('root-admin-provider-dialog-webhooks')).toHaveTextContent('Off');
    await userEvent.click(screen.getByTestId('root-admin-provider-dialog-edit'));
    await userEvent.selectOptions(screen.getByTestId('root-admin-provider-dialog-webhooks-input'), 'on');
    await userEvent.click(screen.getByTestId('root-admin-provider-dialog-save'));

    expect(await screen.findByText('Save failed')).toBeInTheDocument();
    expect(mocks.updateProviderSettings).toHaveBeenCalledWith(expect.objectContaining({ body: { webhooksEnabled: true } }));
    expect(screen.getByTestId('root-admin-provider-dialog-webhooks-input')).toBeInTheDocument();
  });

  it('says when webhooks are switched on but their secret is not set, and shows a provider with no sync run in the hour as No runs', async () => {
    seed({ providers: [provider({ status: null, errorRate: null, webhooksEnabled: false, settings: providerSettingsFixture({ webhookSecretSet: false }) })] });
    renderPage();

    const row = within(await screen.findByTestId('root-admin-provider-balldontlie'));
    expect(row.getAllByText('No runs').length).toBe(2);
    await userEvent.click(screen.getByTestId('root-admin-provider-balldontlie'));
    expect(await screen.findByTestId('root-admin-provider-dialog-webhooks')).toHaveTextContent('Off: switched on, but its signing secret is not set');
  });

  it('offers no Edit for a provider with no Provider row', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-provider-mock'));
    const dialog = within(await screen.findByTestId('root-admin-provider-dialog'));
    expect(dialog.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
  });

  it('lists each provider league with its sport, switch and lengths, and Edit saves only what changed', async () => {
    seed();
    mocks.updateProviderLeague.mockResolvedValue({ data: { league: providerSettingsFixture().leagues[1] } });
    renderPage();

    const mlb = within(await screen.findByTestId('root-admin-provider-league-mlb'));
    expect(mlb.getByText('MLB')).toBeInTheDocument();
    expect(mlb.getByText('180')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('root-admin-provider-league-mlb'));
    expect(await screen.findByTestId('root-admin-provider-league-dialog-typical')).toHaveTextContent('180 minutes');
    await userEvent.click(screen.getByTestId('root-admin-provider-league-dialog-edit'));
    const typical = screen.getByTestId('root-admin-provider-league-dialog-typical-input');
    await userEvent.clear(typical);
    await userEvent.type(typical, '200');
    await userEvent.click(screen.getByTestId('root-admin-provider-league-dialog-save'));

    await waitFor(() => expect(mocks.updateProviderLeague).toHaveBeenCalledWith(expect.objectContaining({
      path: { providerId: providerSettingsFixture().id, providerLeagueId: '00000000-0000-4000-8000-0000000000c2' },
      body: { typicalGameMinutes: 200 },
    })));
  });

  it('keeps a league\'s Save off for a length outside the range the API sends', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-provider-league-mlb'));
    await userEvent.click(await screen.findByTestId('root-admin-provider-league-dialog-edit'));
    const typical = screen.getByTestId('root-admin-provider-league-dialog-typical-input');
    await userEvent.clear(typical);
    await userEvent.type(typical, '700');

    expect(await screen.findByText('Enter a whole number from 5 to 600')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-provider-league-dialog-save')).toBeDisabled();
  });

  it('checks only for a whole number while the API has sent no ranges', async () => {
    seed();
    mocks.listProviders.mockResolvedValue({ data: { providers: [provider()] } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-provider-league-mlb'));
    await userEvent.click(await screen.findByTestId('root-admin-provider-league-dialog-edit'));
    const typical = screen.getByTestId('root-admin-provider-league-dialog-typical-input');
    await userEvent.clear(typical);
    await userEvent.type(typical, '2.5');

    expect(await screen.findByText('Enter a whole number')).toBeInTheDocument();
  });

  it('shows a row per sync with how often it runs and which events it covers, Field always running and a switched-off sync as Off', async () => {
    seed({ schedule: EVENTS_OFF });
    renderPage();

    const rows = await screen.findAllByTestId(/^root-admin-sync-schedule-(EVENTS|FIELD|SCORES)$/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['root-admin-sync-schedule-EVENTS', 'root-admin-sync-schedule-FIELD', 'root-admin-sync-schedule-SCORES']);
    const field = within(screen.getByTestId('root-admin-sync-schedule-FIELD'));
    expect(field.getByText('Field')).toBeInTheDocument();
    expect(field.getByText('6 h')).toBeInTheDocument();
    expect(field.getByText('Events starting in the next 14 days')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-sync-schedule-SCORES')).getByText('5 min')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-sync-schedule-SCORES')).getByText('Events in progress; webhooks arrive between runs')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-sync-schedule-EVENTS')).getByText('Off')).toBeInTheDocument();
    expect(screen.queryByText('Health check')).not.toBeInTheDocument();
  });

  it('opens a sync in view with who last changed the schedule, then Edit saves only that sync\'s interval and comes back to the view', async () => {
    seed();
    mocks.updateIngestionSchedule.mockResolvedValue({ data: { ...SCHEDULE_READ, EVENTS: { enabled: true, intervalMinutes: 120, runs: true, switchable: true } } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-EVENTS'));
    expect(await screen.findByTestId('root-admin-sync-schedule-dialog-last-changed')).toHaveTextContent('by Derek');
    expect(screen.getByTestId('root-admin-sync-schedule-dialog-every')).toHaveTextContent('6 h');

    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-edit'));
    expect(screen.queryByTestId('root-admin-sync-schedule-dialog-lookahead-days')).not.toBeInTheDocument();
    const interval = screen.getByTestId('root-admin-sync-schedule-dialog-interval');
    await userEvent.clear(interval);
    await userEvent.type(interval, '120');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));

    await waitFor(() => expect(mocks.updateIngestionSchedule).toHaveBeenCalledWith(expect.objectContaining({
      body: { EVENTS: { enabled: true, intervalMinutes: 120 } },
    })));
    expect(await screen.findByTestId('root-admin-sync-schedule-dialog-edit')).toBeInTheDocument();
  });

  it('switches a sync that is off back on, saving its switch with its interval, while Field has no switch', async () => {
    seed({ schedule: EVENTS_OFF });
    mocks.updateIngestionSchedule.mockResolvedValue({ data: SCHEDULE_READ });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-EVENTS'));
    expect(await screen.findByTestId('root-admin-sync-schedule-dialog-every')).toHaveTextContent('Off');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-edit'));
    const enabled = screen.getByTestId('root-admin-sync-schedule-dialog-enabled');
    expect(enabled).not.toBeChecked();
    await userEvent.click(enabled);
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));
    await waitFor(() => expect(mocks.updateIngestionSchedule).toHaveBeenCalledWith(expect.objectContaining({
      body: { EVENTS: { enabled: true, intervalMinutes: 360 } },
    })));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-FIELD'));
    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-dialog-edit'));
    expect(screen.queryByTestId('root-admin-sync-schedule-dialog-enabled')).not.toBeInTheDocument();
  });

  it('shows no switch for a sync the API says has none, whichever sync it is, and saves it without one', async () => {
    seed({ schedule: { ...SCHEDULE_READ, SCORES: { intervalSeconds: 300, runs: true, switchable: false } } });
    mocks.updateIngestionSchedule.mockResolvedValue({ data: SCHEDULE_READ });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-SCORES'));
    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-dialog-edit'));
    expect(screen.queryByTestId('root-admin-sync-schedule-dialog-enabled')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByTestId('root-admin-sync-schedule-dialog-interval'));
    await userEvent.type(screen.getByTestId('root-admin-sync-schedule-dialog-interval'), '60');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));

    await waitFor(() => expect(mocks.updateIngestionSchedule).toHaveBeenCalledWith(expect.objectContaining({ body: { SCORES: { intervalSeconds: 60 } } })));
  });

  it('saves the live score interval in seconds and Field\'s interval with its days ahead', async () => {
    seed();
    mocks.updateIngestionSchedule.mockResolvedValue({ data: SCHEDULE_READ });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-SCORES'));
    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-dialog-edit'));
    expect(screen.getByText('Every, seconds')).toBeInTheDocument();
    await userEvent.clear(screen.getByTestId('root-admin-sync-schedule-dialog-interval'));
    await userEvent.type(screen.getByTestId('root-admin-sync-schedule-dialog-interval'), '60');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));
    await waitFor(() => expect(mocks.updateIngestionSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      body: { SCORES: { enabled: true, intervalSeconds: 60 } },
    })));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-FIELD'));
    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-dialog-edit'));
    expect(screen.getByText('Every, minutes')).toBeInTheDocument();
    await userEvent.clear(screen.getByTestId('root-admin-sync-schedule-dialog-lookahead-days'));
    await userEvent.type(screen.getByTestId('root-admin-sync-schedule-dialog-lookahead-days'), '21');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));
    await waitFor(() => expect(mocks.updateIngestionSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      body: { FIELD: { intervalMinutes: 360, lookaheadDays: 21 } },
    })));
  });

  it('refuses an interval that is not a whole number of at least 1, and days ahead below 0, keeping Save off', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-FIELD'));
    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-dialog-edit'));
    const interval = screen.getByTestId('root-admin-sync-schedule-dialog-interval');
    for (const bad of ['0', '1.5', 'abc']) {
      await userEvent.clear(interval);
      await userEvent.type(interval, bad);
      expect(await screen.findByText('Enter a whole number, 1 or more')).toBeInTheDocument();
      expect(screen.getByTestId('root-admin-sync-schedule-dialog-save')).toBeDisabled();
    }
    await userEvent.clear(interval);
    await userEvent.type(interval, '30');
    const days = screen.getByTestId('root-admin-sync-schedule-dialog-lookahead-days');
    await userEvent.clear(days);
    await userEvent.type(days, '-1');
    expect(await screen.findByText('Enter a whole number of days, 0 or more')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sync-schedule-dialog-save')).toBeDisabled();
    expect(mocks.updateIngestionSchedule).not.toHaveBeenCalled();
  });

  it('Cancel in the form goes back to the view unsaved, and a schedule on its defaults says it was never changed', async () => {
    seed({ group: scheduleGroup(SCHEDULE, false) });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-SCORES'));
    expect(await screen.findByTestId('root-admin-sync-schedule-dialog-last-changed')).toHaveTextContent('Never: on the defaults');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-edit'));
    await userEvent.clear(screen.getByTestId('root-admin-sync-schedule-dialog-interval'));
    await userEvent.type(screen.getByTestId('root-admin-sync-schedule-dialog-interval'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('root-admin-sync-schedule-dialog-every')).toHaveTextContent('5 min');
    expect(mocks.updateIngestionSchedule).not.toHaveBeenCalled();
  });

  it('shows a refused save in the form, which stays open', async () => {
    seed();
    mocks.updateIngestionSchedule.mockResolvedValue({ error: { error: { code: 'VALIDATION_ERROR', message: 'Interval too long' } } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-EVENTS'));
    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-dialog-edit'));
    await userEvent.clear(screen.getByTestId('root-admin-sync-schedule-dialog-interval'));
    await userEvent.type(screen.getByTestId('root-admin-sync-schedule-dialog-interval'), '10');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));

    expect(await screen.findByText('Save failed')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sync-schedule-dialog-interval')).toBeInTheDocument();
  });

  it('says so when the providers cannot be checked or the schedule cannot be read', async () => {
    mocks.listProviders.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'down' } } });
    mocks.getSettingsGroup.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'down' } } });
    mocks.getIngestionSchedule.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'down' } } });
    renderPage();

    expect(await screen.findByTestId('root-admin-providers-state-error')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-sync-schedules-state-error')).toBeInTheDocument();
  });
});
