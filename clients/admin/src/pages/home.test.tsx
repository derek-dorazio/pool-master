import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as HomePage } from './home';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockMetricsData = {
  metrics: {
    activeTenants: { value: 24, trend: 12 },
    totalUsers: { value: 1245, trend: 8 },
    activeContests: { value: 156, trend: 15 },
    liveDrafts: { value: 3, trend: -3 },
    notificationRate: { value: 98.5, trend: 0.5 },
  },
  services: [
    { name: 'API Gateway', status: 'green' },
    { name: 'Auth Service', status: 'green' },
    { name: 'Scoring Engine', status: 'yellow' },
  ],
  alerts: [
    { id: 'a1', severity: 'Warning' as const, message: 'High API latency detected', timestamp: new Date().toISOString() },
    { id: 'a2', severity: 'Info' as const, message: 'Scheduled maintenance window', timestamp: new Date().toISOString() },
  ],
  audit: [
    { id: 'au1', adminName: 'Sarah Chen', action: 'updated', description: 'Changed feature flag', timestamp: new Date().toISOString() },
  ],
};

let mockIsLoading = false;
let mockData: typeof mockMetricsData | undefined = mockMetricsData;

vi.mock('@/hooks/use-admin-api', () => ({
  useAdminMetrics: () => ({
    data: mockData,
    isLoading: mockIsLoading,
  }),
}));

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLoading = false;
    mockData = mockMetricsData;
  });

  it('renders "Platform Overview" heading', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: 'Platform Overview' })).toBeInTheDocument();
  });

  it('renders metric cards (Active Tenants, Total Users, Active Contests)', () => {
    renderHome();

    expect(screen.getByText('Active Tenants')).toBeInTheDocument();
    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText('Active Contests')).toBeInTheDocument();
  });

  it('renders Service Health section', () => {
    renderHome();

    expect(screen.getByText('Service Health')).toBeInTheDocument();
    expect(screen.getByText('API Gateway')).toBeInTheDocument();
    expect(screen.getByText('Auth Service')).toBeInTheDocument();
    expect(screen.getByText('Scoring Engine')).toBeInTheDocument();
  });

  it('renders Quick Actions buttons', () => {
    renderHome();

    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search user/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search tenant/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view providers/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view flags/i })).toBeInTheDocument();
  });

  it('renders loading state when isLoading', () => {
    mockIsLoading = true;
    mockData = undefined;
    renderHome();

    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument();
    expect(screen.queryByText('Platform Overview')).not.toBeInTheDocument();
  });
});
