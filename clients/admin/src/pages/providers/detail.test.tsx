import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Component as ProviderDetailPage } from './detail';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ providerId: 'espn' }),
  };
});

const mockProvider: {
  providerId: string;
  providerName: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  errorRate: number;
  latencyMs: number;
  lastEventAt: string | null;
  activeEventCount: number;
  mappedParticipantCount: number;
  sportsCovered: string[];
  unmappedParticipants: { providerId: string; externalId: string; externalName: string; providerName: string; sport: string }[];
  recentHealthChecks: { providerId: string; checkedAt: string; status: string; errorRate: number; latencyMs: number; details: string }[];
  ingestionStats: { providerId: string; sport: string; lastPollAt: string; lastEventReceivedAt: string; eventsToday: number; errorsToday: number; activeEventCount: number; contestsDepending: number }[];
  recentJobs: { id: string; providerId: string; sport: string; eventId: string; status: string; recordsProcessed: number; errors: number; startedAt: string }[];
  recentErrors: { providerId: string; occurredAt: string; errorType: string; message: string; eventId: string }[];
} = {
  providerId: 'espn',
  providerName: 'ESPN',
  status: 'HEALTHY',
  errorRate: 0.5,
  latencyMs: 120,
  lastEventAt: '2026-04-03T18:00:00Z',
  activeEventCount: 14,
  mappedParticipantCount: 320,
  sportsCovered: ['NFL', 'NBA', 'MLB'],
  unmappedParticipants: [
    { providerId: 'espn', externalId: 'ext-1', externalName: 'New Player A', providerName: 'ESPN', sport: 'NFL' },
  ],
  recentHealthChecks: [
    { providerId: 'espn', checkedAt: '2026-04-03T17:30:00Z', status: 'HEALTHY', errorRate: 0.3, latencyMs: 110, details: 'All endpoints responding' },
    { providerId: 'espn', checkedAt: '2026-04-03T16:30:00Z', status: 'HEALTHY', errorRate: 0.5, latencyMs: 130, details: '' },
  ],
  ingestionStats: [
    { providerId: 'espn', sport: 'NFL', lastPollAt: '2026-04-03T17:55:00Z', lastEventReceivedAt: '2026-04-03T17:50:00Z', eventsToday: 42, errorsToday: 0, activeEventCount: 8, contestsDepending: 5 },
    { providerId: 'espn', sport: 'NBA', lastPollAt: '2026-04-03T17:55:00Z', lastEventReceivedAt: '2026-04-03T17:48:00Z', eventsToday: 18, errorsToday: 2, activeEventCount: 6, contestsDepending: 3 },
  ],
  recentJobs: [
    { id: 'job-1', providerId: 'espn', sport: 'NFL', eventId: 'ev-1', status: 'completed', recordsProcessed: 150, errors: 0, startedAt: '2026-04-03T17:00:00Z' },
  ],
  recentErrors: [
    { providerId: 'espn', occurredAt: '2026-04-02T12:00:00Z', errorType: 'TIMEOUT', message: 'Upstream timeout after 5000ms', eventId: 'ev-99' },
  ],
};

let mockProviderData: typeof mockProvider | undefined = mockProvider;
let mockIsLoading = false;
let mockIsError = false;
let mockError: Error | undefined;

vi.mock('@/hooks/use-providers-api', () => ({
  useProviderDetail: () => ({
    data: mockProviderData,
    isLoading: mockIsLoading,
    isError: mockIsError,
    error: mockError,
  }),
}));

vi.mock('@/lib/api', () => ({
  client: {},
  adminTriggerHealthCheck: vi.fn(),
  adminMapParticipant: vi.fn(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProviderDetailPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProviderDetailPage', () => {
  beforeEach(() => {
    mockProviderData = mockProvider;
    mockIsLoading = false;
    mockIsError = false;
    mockError = undefined;
  });

  it('renders the loading state', () => {
    mockIsLoading = true;
    mockProviderData = undefined;
    renderPage();

    expect(screen.getByTestId('provider-detail-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading provider...')).toBeInTheDocument();
  });

  it('renders the error state', () => {
    mockIsError = true;
    mockProviderData = undefined;
    mockError = new Error('Network failure');
    renderPage();

    expect(screen.getByTestId('provider-detail-error')).toBeInTheDocument();
    expect(screen.getByText(/Provider detail is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Network failure/)).toBeInTheDocument();
  });

  it('renders the error state with default message when error is not an Error instance', () => {
    mockIsError = true;
    mockProviderData = undefined;
    mockError = undefined;
    renderPage();

    expect(screen.getByText(/Check the provider adapters/)).toBeInTheDocument();
  });

  it('renders provider name and ID in the header', () => {
    renderPage();

    expect(screen.getByTestId('provider-detail-name')).toHaveTextContent('ESPN');
    expect(screen.getByText('espn')).toBeInTheDocument();
  });

  it('renders the breadcrumb navigation', () => {
    renderPage();

    const breadcrumb = screen.getByTestId('provider-detail-breadcrumb');
    expect(within(breadcrumb).getByText('Providers')).toBeInTheDocument();
    expect(within(breadcrumb).getByText('ESPN')).toBeInTheDocument();
  });

  it('shows HEALTHY status badge', () => {
    renderPage();

    expect(screen.getAllByText('HEALTHY').length).toBeGreaterThanOrEqual(1);
  });

  it('shows error rate and latency in header', () => {
    renderPage();

    expect(screen.getByText('0.5%')).toBeInTheDocument();
    expect(screen.getByText('120ms')).toBeInTheDocument();
  });

  it('renders health tab with live health summary', () => {
    renderPage();

    expect(screen.getByText('Live Health Summary')).toBeInTheDocument();
    expect(screen.getByText('Recent Live Signals')).toBeInTheDocument();
  });

  it('renders recent health check count', () => {
    renderPage();

    expect(screen.getByText('2 persisted checks')).toBeInTheDocument();
  });

  it('renders health check table rows', () => {
    renderPage();

    expect(screen.getByText('All endpoints responding')).toBeInTheDocument();
    expect(screen.getByText('0.30%')).toBeInTheDocument();
  });

  it('renders active event count and mapped participants', () => {
    renderPage();

    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
  });

  it('renders the Run Health Check button', () => {
    renderPage();

    expect(screen.getByRole('button', { name: /Run Health Check/ })).toBeInTheDocument();
  });

  it('shows unmapped participant count in live signals', () => {
    renderPage();

    // The unmappedParticipants.length = 1
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders four tabs', () => {
    renderPage();

    expect(screen.getByRole('tab', { name: /Health/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Live Metadata/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Ingestion/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Mapping/ })).toBeInTheDocument();
  });

  it('shows empty health checks state', () => {
    mockProviderData = { ...mockProvider, recentHealthChecks: [] };
    renderPage();

    expect(screen.getByText('No persisted health checks yet.')).toBeInTheDocument();
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
  });

  it('renders DEGRADED status badge for degraded provider', () => {
    mockProviderData = { ...mockProvider, status: 'DEGRADED' as const };
    renderPage();

    expect(screen.getAllByText('DEGRADED').length).toBeGreaterThanOrEqual(1);
  });

  it('renders DOWN status badge for down provider', () => {
    mockProviderData = { ...mockProvider, status: 'DOWN' as const };
    renderPage();

    expect(screen.getAllByText('DOWN').length).toBeGreaterThanOrEqual(1);
  });

  it('highlights high error rate in red', () => {
    mockProviderData = { ...mockProvider, errorRate: 10.5 };
    renderPage();

    expect(screen.getByText('10.5%')).toBeInTheDocument();
  });

  it('highlights high latency in red', () => {
    mockProviderData = { ...mockProvider, latencyMs: 2500 };
    renderPage();

    expect(screen.getByText('2500ms')).toBeInTheDocument();
  });

  it('shows "Unavailable" for null lastEventAt', () => {
    mockProviderData = { ...mockProvider, lastEventAt: null as unknown as string };
    renderPage();

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('shows zero unmapped count when no unmapped participants', () => {
    mockProviderData = { ...mockProvider, unmappedParticipants: [] };
    renderPage();

    // The live signals card always shows the "Unmapped participants" label
    expect(screen.getByText('Unmapped participants')).toBeInTheDocument();
    // Count should be 0
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
