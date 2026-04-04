import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { Component as PlatformConfigPage } from './platform';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  updatePollIntervals: vi.fn().mockResolvedValue(undefined),
  resetPollIntervals: vi.fn().mockResolvedValue(undefined),
  updateIngestionSchedule: vi.fn().mockResolvedValue(undefined),
  resetIngestionSchedule: vi.fn().mockResolvedValue(undefined),
  updateDunningConfig: vi.fn().mockResolvedValue(undefined),
  resetDunningConfig: vi.fn().mockResolvedValue(undefined),
  updateRetentionDefaults: vi.fn().mockResolvedValue(undefined),
  resetRetentionDefaults: vi.fn().mockResolvedValue(undefined),
  getTenantRetentionOverride: vi.fn().mockResolvedValue({ data: null }),
  clearTenantRetentionOverride: vi.fn().mockResolvedValue(undefined),
  setTenantRetentionOverride: vi.fn().mockResolvedValue(undefined),
  pollIntervals: {
    data: {
      standings: 30000,
      draft: 5000,
      contestStatus: 60000,
      notifications: 15000,
      default: 30000,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  ingestionSchedule: {
    data: {
      healthCheckMin: 5,
      scheduleSyncHrs: 6,
      participantSyncHrs: 12,
      rankingSyncHrs: 24,
      liveScorePollingSeconds: 30,
      sportOverrides: [
        {
          sport: 'NFL',
          healthCheckMin: 3,
          scheduleSyncHrs: 4,
          participantSyncHrs: 8,
          rankingSyncHrs: 12,
          liveScorePollingSeconds: 15,
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  dunningConfig: {
    data: {
      retryAttempts: [
        { day: 1, action: 'Retry payment' },
        { day: 3, action: 'Retry payment' },
        { day: 7, action: 'Final retry' },
      ],
      gracePeriodDays: 7,
      degradedPeriodDays: 14,
      cancellationThresholdDays: 30,
      notifyOnRetry: true,
      notifyOnGraceStart: true,
      notifyOnDegradation: true,
      notifyBeforeCancellation: true,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  retentionDefaults: {
    data: {
      contestResultRetentionSeasons: 5,
      rosterHistoryRetentionSeasons: 3,
      activityLogRetentionDays: 365,
      payoutRecordRetentionSeasons: 7,
      chatMessageRetentionDays: 180,
      auditLogRetentionDays: 730,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock('@/lib/api', () => ({
  client: {},
  adminUpdatePollIntervals: mocks.updatePollIntervals,
  adminResetPollIntervals: mocks.resetPollIntervals,
  adminUpdateIngestionSchedule: mocks.updateIngestionSchedule,
  adminResetIngestionSchedule: mocks.resetIngestionSchedule,
  adminUpdateDunningConfig: mocks.updateDunningConfig,
  adminResetDunningConfig: mocks.resetDunningConfig,
  adminUpdateRetentionDefaults: mocks.updateRetentionDefaults,
  adminResetRetentionDefaults: mocks.resetRetentionDefaults,
  adminGetTenantRetentionOverride: mocks.getTenantRetentionOverride,
  adminClearTenantRetentionOverride: mocks.clearTenantRetentionOverride,
  adminSetTenantRetentionOverride: mocks.setTenantRetentionOverride,
}));

vi.mock('@/hooks/use-config-api', () => ({
  usePollIntervals: () => mocks.pollIntervals,
  useIngestionSchedule: () => mocks.ingestionSchedule,
  useDunningConfig: () => mocks.dunningConfig,
  useRetentionDefaults: () => mocks.retentionDefaults,
}));

function renderPage() {
  return render(<PlatformConfigPage />);
}

function resetHookState() {
  Object.assign(mocks.pollIntervals, {
    data: {
      standings: 30000,
      draft: 5000,
      contestStatus: 60000,
      notifications: 15000,
      default: 30000,
    },
    isLoading: false,
    isError: false,
  });
  Object.assign(mocks.ingestionSchedule, {
    data: {
      healthCheckMin: 5,
      scheduleSyncHrs: 6,
      participantSyncHrs: 12,
      rankingSyncHrs: 24,
      liveScorePollingSeconds: 30,
      sportOverrides: [
        {
          sport: 'NFL',
          healthCheckMin: 3,
          scheduleSyncHrs: 4,
          participantSyncHrs: 8,
          rankingSyncHrs: 12,
          liveScorePollingSeconds: 15,
        },
      ],
    },
    isLoading: false,
    isError: false,
  });
  Object.assign(mocks.dunningConfig, {
    data: {
      retryAttempts: [
        { day: 1, action: 'Retry payment' },
        { day: 3, action: 'Retry payment' },
        { day: 7, action: 'Final retry' },
      ],
      gracePeriodDays: 7,
      degradedPeriodDays: 14,
      cancellationThresholdDays: 30,
      notifyOnRetry: true,
      notifyOnGraceStart: true,
      notifyOnDegradation: true,
      notifyBeforeCancellation: true,
    },
    isLoading: false,
    isError: false,
  });
  Object.assign(mocks.retentionDefaults, {
    data: {
      contestResultRetentionSeasons: 5,
      rosterHistoryRetentionSeasons: 3,
      activityLogRetentionDays: 365,
      payoutRecordRetentionSeasons: 7,
      chatMessageRetentionDays: 180,
      auditLogRetentionDays: 730,
    },
    isLoading: false,
    isError: false,
  });
}

function getNumberInput(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  const input = label.nextElementSibling as HTMLInputElement | null;
  if (!input) {
    throw new Error(`Unable to find input for ${labelText}`);
  }
  return input;
}

describe('PlatformConfigPage', () => {
  beforeEach(() => {
    mocks.invalidateQueries.mockClear();
    mocks.updatePollIntervals.mockClear();
    mocks.resetPollIntervals.mockClear();
    mocks.updateIngestionSchedule.mockClear();
    mocks.resetIngestionSchedule.mockClear();
    mocks.updateDunningConfig.mockClear();
    mocks.resetDunningConfig.mockClear();
    mocks.updateRetentionDefaults.mockClear();
    mocks.resetRetentionDefaults.mockClear();
    mocks.getTenantRetentionOverride.mockClear();
    mocks.clearTenantRetentionOverride.mockClear();
    mocks.setTenantRetentionOverride.mockClear();
    mocks.pollIntervals.refetch.mockClear();
    mocks.ingestionSchedule.refetch.mockClear();
    mocks.dunningConfig.refetch.mockClear();
    mocks.retentionDefaults.refetch.mockClear();
    resetHookState();
  });

  it('renders the platform configuration sections with live config values', () => {
    renderPage();

    expect(screen.getByText('Platform Configuration')).toBeInTheDocument();
    expect(screen.getByText('Poll Intervals')).toBeInTheDocument();
    expect(screen.getByText('Ingestion Schedule')).toBeInTheDocument();
    expect(screen.getByText('Dunning Schedule')).toBeInTheDocument();
    expect(screen.getByText('Retention Defaults')).toBeInTheDocument();
    expect(screen.getAllByText('Refresh every 30s').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Refresh every 1 min')).toBeInTheDocument();
  });

  it('saves and resets poll intervals with the generated contract body', async () => {
    const user = userEvent.setup();
    renderPage();

    const draftInput = getNumberInput('Draft (ms)');
    await user.clear(draftInput);
    await user.type(draftInput, '8000');

    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(mocks.updatePollIntervals).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          standings: 30000,
          draft: 8000,
          contestStatus: 60000,
          notifications: 15000,
          default: 30000,
        },
      }),
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['admin', 'config', 'poll-intervals'],
    });

    await user.click(screen.getAllByRole('button', { name: 'Reset' })[0]);

    expect(mocks.resetPollIntervals).toHaveBeenCalledWith(
      expect.objectContaining({ client: {} }),
    );
  }, 10000);

  it('saves ingestion schedule fields using the update contract names', async () => {
    const user = userEvent.setup();
    renderPage();

    const scheduleSyncInput = getNumberInput('Schedule sync (hrs)');
    await user.clear(scheduleSyncInput);
    await user.type(scheduleSyncInput, '8');

    await user.click(screen.getAllByRole('button', { name: 'Save' })[1]);

    expect(mocks.updateIngestionSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          healthCheckIntervalMinutes: 5,
          scheduleSyncIntervalHours: 8,
          participantSyncIntervalHours: 12,
          rankingSyncIntervalHours: 24,
          liveScorePollingIntervalSeconds: 30,
        },
      }),
    );
  }, 10000);

  it('saves dunning schedule fields using the generated contract names', async () => {
    const user = userEvent.setup();
    renderPage();

    const gracePeriodInput = getNumberInput('Grace period (days)');
    await user.clear(gracePeriodInput);
    await user.type(gracePeriodInput, '10');

    await user.click(screen.getAllByRole('button', { name: 'Save' })[2]);

    expect(mocks.updateDunningConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          retryAttempts: [
            { daysAfterFailure: 1, action: 'Retry payment' },
            { daysAfterFailure: 3, action: 'Retry payment' },
            { daysAfterFailure: 7, action: 'Final retry' },
          ],
          gracePeriodDays: 10,
          degradedPeriodDays: 14,
          cancellationDays: 30,
          notifyOnRetry: true,
          notifyOnGracePeriodStart: true,
          notifyOnDegradation: true,
          notifyBeforeCancellation: true,
        },
      }),
    );
  }, 10000);

  it('shows the loading state instead of fallback config data', () => {
    Object.assign(mocks.pollIntervals, {
      data: undefined,
      isLoading: true,
      isError: false,
    });
    Object.assign(mocks.ingestionSchedule, {
      data: undefined,
      isLoading: true,
      isError: false,
    });
    Object.assign(mocks.dunningConfig, {
      data: undefined,
      isLoading: true,
      isError: false,
    });
    Object.assign(mocks.retentionDefaults, {
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderPage();

    expect(screen.getAllByText('Loading...').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Refresh every 30s')).not.toBeInTheDocument();
  });

  it('shows an error state when poll intervals fail to load', () => {
    Object.assign(mocks.pollIntervals, {
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderPage();

    expect(screen.getByText('Unable to load poll intervals.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
