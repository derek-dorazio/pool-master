import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IngestionScheduleConfig, ProviderSummaryDto, SettingsGroup } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminProvidersPage } from './root-admin-providers-page';

// /manage/providers: the providers grid with each provider's view-only dialog and its Check now,
// and the sync schedules grid with each sync's view-then-Edit dialog.

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  getSettingsGroup: vi.fn(),
  updateIngestionSchedule: vi.fn(),
}));

bindApiMocks(mocks);

function provider(overrides: Partial<ProviderSummaryDto> = {}): ProviderSummaryDto {
  return {
    providerId: 'balldontlie',
    providerName: 'BALLDONTLIE',
    status: 'HEALTHY',
    errorRate: 0.004,
    latencyMs: 420,
    lastEventAt: null,
    sportsCovered: ['GOLF'],
    primaryForSports: ['GOLF'],
    activeEventCount: 3,
    supportsLiveSimulation: false,
    requestsPerMinute: 5,
    webhooksEnabled: true,
    syncedSportLeagueCount: 16,
    ...overrides,
  };
}

const SCHEDULE: IngestionScheduleConfig = {
  scheduledSports: ['GOLF'],
  healthCheck: { enabled: true, intervalMinutes: 5 },
  eventList: { enabled: true, intervalMinutes: 360 },
  eventParticipants: { enabled: false, intervalMinutes: 360, lookaheadDays: 14 },
  eventLiveScores: { enabled: true, intervalSeconds: 300 },
};

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

function seed({ providers = [provider(), provider({ providerId: 'mock', providerName: 'Mock feed', status: 'DOWN', requestsPerMinute: null, webhooksEnabled: false, syncedSportLeagueCount: 0 })], group = scheduleGroup() } = {}) {
  mocks.listProviders.mockResolvedValue({ data: { providers } });
  mocks.getSettingsGroup.mockResolvedValue({ data: group });
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

  it('lists each provider with its status in a word, its request rate, sport leagues, error rate as a percent and latency', async () => {
    seed();
    renderPage();

    const balldontlie = within(await screen.findByTestId('root-admin-provider-balldontlie'));
    expect(balldontlie.getByText('BALLDONTLIE')).toBeInTheDocument();
    expect(balldontlie.getByText('Up')).toBeInTheDocument();
    expect(balldontlie.getByText('5')).toBeInTheDocument();
    expect(balldontlie.getByText('16')).toBeInTheDocument();
    expect(balldontlie.getByText('0.4%')).toBeInTheDocument();
    expect(balldontlie.getByText('420')).toBeInTheDocument();
    const mock = within(screen.getByTestId('root-admin-provider-mock'));
    expect(mock.getByText('Down')).toBeInTheDocument();
    expect(mock.getByText('Not paced')).toBeInTheDocument();
  });

  it('opens a provider in a view-only dialog with Close and Check now, no Edit, and Check now checks the providers again', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-provider-balldontlie'));
    const dialog = within(await screen.findByTestId('root-admin-provider-dialog'));
    expect(dialog.getByText('Webhooks')).toBeInTheDocument();
    expect(dialog.getByText('On')).toBeInTheDocument();
    expect(dialog.getByText('420 ms')).toBeInTheDocument();
    expect(dialog.getByText('Checked')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(mocks.listProviders).toHaveBeenCalledTimes(1);

    await userEvent.click(dialog.getByTestId('root-admin-provider-dialog-check'));

    await waitFor(() => expect(mocks.listProviders).toHaveBeenCalledTimes(2));
    await userEvent.click(dialog.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('root-admin-provider-dialog')).not.toBeInTheDocument();
  });

  it('shows a row per sync with how often it runs and which events it covers, Field always running and a switched-off sync as Off', async () => {
    seed({ group: scheduleGroup({ ...SCHEDULE, healthCheck: { enabled: false, intervalMinutes: 5 } }) });
    renderPage();

    const field = within(await screen.findByTestId('root-admin-sync-schedule-eventParticipants'));
    expect(field.getByText('6 h')).toBeInTheDocument();
    expect(field.getByText('Events starting in the next 14 days')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-sync-schedule-eventList')).getByText('6 h')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-sync-schedule-eventLiveScores')).getByText('5 min')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-sync-schedule-eventLiveScores')).getByText('Events in progress; webhooks arrive between runs')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-sync-schedule-healthCheck')).getByText('Off')).toBeInTheDocument();
  });

  it('opens a sync in view with who last changed the schedule, then Edit saves only that sync\'s interval and comes back to the view', async () => {
    seed();
    mocks.updateIngestionSchedule.mockResolvedValue({ data: { ...SCHEDULE, eventList: { enabled: true, intervalMinutes: 120 } } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-eventList'));
    expect(await screen.findByTestId('root-admin-sync-schedule-dialog-last-changed')).toHaveTextContent('by Derek');
    expect(screen.getByTestId('root-admin-sync-schedule-dialog-every')).toHaveTextContent('6 h');

    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-edit'));
    expect(screen.queryByTestId('root-admin-sync-schedule-dialog-lookahead-days')).not.toBeInTheDocument();
    const interval = screen.getByTestId('root-admin-sync-schedule-dialog-interval');
    await userEvent.clear(interval);
    await userEvent.type(interval, '120');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));

    await waitFor(() => expect(mocks.updateIngestionSchedule).toHaveBeenCalledWith(expect.objectContaining({
      body: { eventList: { enabled: true, intervalMinutes: 120 } },
    })));
    expect(await screen.findByTestId('root-admin-sync-schedule-dialog-edit')).toBeInTheDocument();
  });

  it('switches a sync that is off back on, saving its switch with its interval, while Field has no switch', async () => {
    seed({ group: scheduleGroup({ ...SCHEDULE, healthCheck: { enabled: false, intervalMinutes: 5 } }) });
    mocks.updateIngestionSchedule.mockResolvedValue({ data: SCHEDULE });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-healthCheck'));
    expect(await screen.findByTestId('root-admin-sync-schedule-dialog-every')).toHaveTextContent('Off');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-edit'));
    const enabled = screen.getByTestId('root-admin-sync-schedule-dialog-enabled');
    expect(enabled).not.toBeChecked();
    await userEvent.click(enabled);
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));
    await waitFor(() => expect(mocks.updateIngestionSchedule).toHaveBeenCalledWith(expect.objectContaining({
      body: { healthCheck: { enabled: true, intervalMinutes: 5 } },
    })));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-eventParticipants'));
    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-dialog-edit'));
    expect(screen.queryByTestId('root-admin-sync-schedule-dialog-enabled')).not.toBeInTheDocument();
  });

  it('saves the live score interval in seconds and Field\'s interval with its days ahead', async () => {
    seed();
    mocks.updateIngestionSchedule.mockResolvedValue({ data: SCHEDULE });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-eventLiveScores'));
    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-dialog-edit'));
    expect(screen.getByText('Every, seconds')).toBeInTheDocument();
    await userEvent.clear(screen.getByTestId('root-admin-sync-schedule-dialog-interval'));
    await userEvent.type(screen.getByTestId('root-admin-sync-schedule-dialog-interval'), '60');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));
    await waitFor(() => expect(mocks.updateIngestionSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      body: { eventLiveScores: { enabled: true, intervalSeconds: 60 } },
    })));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-eventParticipants'));
    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-dialog-edit'));
    expect(screen.getByText('Every, minutes')).toBeInTheDocument();
    await userEvent.clear(screen.getByTestId('root-admin-sync-schedule-dialog-lookahead-days'));
    await userEvent.type(screen.getByTestId('root-admin-sync-schedule-dialog-lookahead-days'), '21');
    await userEvent.click(screen.getByTestId('root-admin-sync-schedule-dialog-save'));
    await waitFor(() => expect(mocks.updateIngestionSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      body: { eventParticipants: { intervalMinutes: 360, lookaheadDays: 21 } },
    })));
  });

  it('refuses an interval that is not a whole number of at least 1, and days ahead below 0, keeping Save off', async () => {
    seed();
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-eventParticipants'));
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

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-healthCheck'));
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

    await userEvent.click(await screen.findByTestId('root-admin-sync-schedule-healthCheck'));
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
    renderPage();

    expect(await screen.findByTestId('root-admin-providers-state-error')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-sync-schedules-state-error')).toBeInTheDocument();
  });
});
