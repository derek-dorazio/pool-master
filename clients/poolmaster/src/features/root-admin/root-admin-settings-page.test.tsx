import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsChange, SettingsGroup } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSettingsPage } from './root-admin-settings-page';

const { listSettingsGroupsMock, listSettingsGroupHistoryMock } = vi.hoisted(() => ({
  listSettingsGroupsMock: vi.fn(),
  listSettingsGroupHistoryMock: vi.fn(),
}));

bindApiMocks({
  listSettingsGroups: listSettingsGroupsMock,
  listSettingsGroupHistory: listSettingsGroupHistoryMock,
});

const POLL_DEFAULTS = { standings: 10000, draft: 10000, contestStatus: 30000, notifications: 30000, default: 30000 };
const INGESTION_DEFAULTS = {
  scheduledSports: ['GOLF' as const],
  healthCheck: { enabled: true, intervalMinutes: 5 },
  eventParticipants: { enabled: false, intervalMinutes: 360, lookaheadDays: 14 },
  eventLiveScores: { enabled: true, intervalSeconds: 300 },
  perSportOverrides: {},
};

const ADMIN = { id: '6f7c1c55-58a4-4bd4-8a2a-0b8e3f1f4a01', name: 'Ada Admin' };

const SAVED_POLL: SettingsGroup = {
  key: 'POLL_INTERVAL_CONFIG',
  title: 'Poll intervals',
  description: 'How often clients refresh standings, drafts, contest status and notifications.',
  source: 'stored',
  updatedAt: '2026-10-07T12:00:00.000Z',
  updatedBy: ADMIN,
  value: { ...POLL_DEFAULTS, standings: 15000 },
  defaults: POLL_DEFAULTS,
};

const DEFAULT_INGESTION: SettingsGroup = {
  key: 'INGESTION_SCHEDULE_CONFIG',
  title: 'Ingestion schedule',
  description: 'Which sports sync on a schedule, and how often each provider feed runs.',
  source: 'defaults',
  updatedAt: null,
  updatedBy: null,
  value: INGESTION_DEFAULTS,
  defaults: INGESTION_DEFAULTS,
};

const POLL_CHANGE: SettingsChange = {
  id: '0c9e1b6e-7a77-4f41-9c3e-5c0b5f6b4a10',
  key: 'POLL_INTERVAL_CONFIG',
  previousValue: POLL_DEFAULTS,
  newValue: { ...POLL_DEFAULTS, standings: 15000 },
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
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [SAVED_POLL, DEFAULT_INGESTION] } });
    listSettingsGroupHistoryMock.mockResolvedValue({ data: { changes: [POLL_CHANGE] } });
  });

  it('shows one card per group with its values, whether they are saved or the defaults, and who last changed them', async () => {
    renderPage();

    const poll = within(await screen.findByTestId('root-admin-settings-group-POLL_INTERVAL_CONFIG'));
    const ingestion = within(screen.getByTestId('root-admin-settings-group-INGESTION_SCHEDULE_CONFIG'));

    expect(poll.getByText('Saved')).toBeInTheDocument();
    expect(poll.getByText('Every 15 s')).toBeInTheDocument();
    expect(poll.getByTestId('root-admin-settings-last-change-POLL_INTERVAL_CONFIG')).toHaveTextContent('Last changed by Ada Admin');
    expect(ingestion.getByText('Defaults')).toBeInTheDocument();
    expect(ingestion.getByText('Never changed: using the defaults.')).toBeInTheDocument();
    expect(ingestion.getByText('Every 300 s')).toBeInTheDocument();
  });

  it('links each group to its existing edit page', async () => {
    renderPage();

    expect(await screen.findByTestId('root-admin-settings-edit-POLL_INTERVAL_CONFIG'))
      .toHaveAttribute('href', '/manage/sync-config/poll-intervals');
    expect(screen.getByTestId('root-admin-settings-edit-INGESTION_SCHEDULE_CONFIG'))
      .toHaveAttribute('href', '/manage/sync-config/ingestion-schedule');
  });

  it('loads a group\'s recent changes only when asked, naming who changed which field', async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-settings-history-toggle-POLL_INTERVAL_CONFIG'));

    const history = await screen.findByTestId('root-admin-settings-history-POLL_INTERVAL_CONFIG');
    expect(history).toHaveTextContent('by Ada Admin: changed standings');
    expect(listSettingsGroupHistoryMock).toHaveBeenCalledTimes(1);
    expect(listSettingsGroupHistoryMock.mock.calls[0][0]).toEqual(expect.objectContaining({ path: { key: 'POLL_INTERVAL_CONFIG' } }));
  });

  it('shows an error state, not stale or sample values, when settings cannot load', async () => {
    listSettingsGroupsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'down' } } });

    renderPage();

    expect(await screen.findByTestId('shared-error-state')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-settings-group-POLL_INTERVAL_CONFIG')).not.toBeInTheDocument();
  });
});
