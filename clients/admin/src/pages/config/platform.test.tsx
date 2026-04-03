import { render, screen } from '@testing-library/react';
import { Component as PlatformConfigPage } from './platform';

vi.mock('@/hooks/use-config-api', () => ({
  usePollIntervals: () => ({
    data: {
      standings: 30000,
      draft: 5000,
      contestStatus: 60000,
      notifications: 15000,
      default: 30000,
    },
    isLoading: false,
  }),
  useIngestionSchedule: () => ({
    data: {
      healthCheckMin: 5,
      scheduleSyncHrs: 6,
      participantSyncHrs: 12,
      rankingSyncHrs: 24,
      liveScorePollingSeconds: 30,
      sportOverrides: [
        { sport: 'NFL', healthCheckMin: 3, scheduleSyncHrs: 4, participantSyncHrs: 8, rankingSyncHrs: 12, liveScorePollingSeconds: 15 },
      ],
    },
    isLoading: false,
  }),
  useDunningConfig: () => ({
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
  }),
  useRetentionDefaults: () => ({
    data: {
      contestResultRetentionSeasons: 5,
      rosterHistoryRetentionSeasons: 3,
      activityLogRetentionDays: 365,
      payoutRecordRetentionSeasons: 7,
      chatMessageRetentionDays: 180,
      auditLogRetentionDays: 730,
    },
    isLoading: false,
  }),
}));

function renderPage() {
  return render(<PlatformConfigPage />);
}

describe('PlatformConfigPage', () => {
  it('renders the poll intervals section with interval fields', () => {
    renderPage();
    expect(screen.getByText('Poll Intervals')).toBeInTheDocument();
    expect(screen.getByText('Standings (ms)')).toBeInTheDocument();
    expect(screen.getByText('Draft (ms)')).toBeInTheDocument();
    expect(screen.getByText('Contest Status (ms)')).toBeInTheDocument();
  });

  it('renders the ingestion schedule section', () => {
    renderPage();
    expect(screen.getByText('Ingestion Schedule')).toBeInTheDocument();
    expect(screen.getByText('Health check (min)')).toBeInTheDocument();
    expect(screen.getByText('Schedule sync (hrs)')).toBeInTheDocument();
    expect(screen.getByText('Live score polling (s)')).toBeInTheDocument();
  });

  it('renders the dunning schedule section with retry attempts', () => {
    renderPage();
    expect(screen.getByText('Dunning Schedule')).toBeInTheDocument();
    expect(screen.getByText('Retry Attempts')).toBeInTheDocument();
    expect(screen.getByText('Grace period (days)')).toBeInTheDocument();
    expect(screen.getByText('Degraded period (days)')).toBeInTheDocument();
  });

  it('renders the retention defaults section', () => {
    renderPage();
    expect(screen.getByText('Retention Defaults')).toBeInTheDocument();
    expect(screen.getByText('Contest Results (seasons)')).toBeInTheDocument();
    expect(screen.getByText('Audit Log (days)')).toBeInTheDocument();
    expect(screen.getByText('Chat Messages (days)')).toBeInTheDocument();
  });
});
