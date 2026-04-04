import { render, screen } from '@testing-library/react';
import { Component as HealthPage } from './index';

const mockHealthData = {
  services: [
    { name: 'API Gateway', status: 'UP' as const, uptime: '99.99%', errorRate: '0.02%', p95Latency: '45ms', version: 'v1.2.0' },
    { name: 'Ingestion Worker', status: 'DEGRADED' as const, uptime: '99.95%', errorRate: '2.1%', p95Latency: '450ms', version: 'v1.2.0' },
    { name: 'Auth Service', status: 'DOWN' as const, uptime: '98.00%', errorRate: '15%', p95Latency: '1200ms', version: 'v1.1.0' },
  ],
  infrastructure: [
    { name: 'PostgreSQL', metric1Label: 'CPU', metric1Value: '35%', metric2Label: 'Connections', metric2Value: '120/500' },
    { name: 'Message Bus', metric1Label: 'Queue Depth', metric1Value: '14', metric2Label: 'Dead Letters', metric2Value: '2' },
    { name: 'S3/CDN', metric1Label: 'Requests', metric1Value: '1.2M', metric2Label: 'Storage', metric2Value: '18GB' },
  ],
  keyMetrics: [
    { label: 'Active Users (24h)', value: '1,245' },
    { label: 'API Requests (24h)', value: '125K' },
    { label: 'Notifications', value: '8,450 sent', detail: '8,320 delivered (98.5%)' },
  ],
  lastRefreshed: new Date(),
};

let mockIsLoading = false;
let mockData: typeof mockHealthData | undefined = mockHealthData;

vi.mock('@/hooks/use-health-api', () => ({
  useHealthDashboard: () => ({
    data: mockData,
    isLoading: mockIsLoading,
  }),
}));

describe('HealthPage', () => {
  beforeEach(() => {
    mockIsLoading = false;
    mockData = mockHealthData;
  });

  it('renders service status table', () => {
    render(<HealthPage />);

    expect(screen.getByText('API Gateway')).toBeInTheDocument();
    expect(screen.getByText('Ingestion Worker')).toBeInTheDocument();
    expect(screen.getByText('Auth Service')).toBeInTheDocument();
  });

  it('shows status indicators with colored dots', () => {
    render(<HealthPage />);

    expect(screen.getByText('UP')).toBeInTheDocument();
    expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    expect(screen.getByText('DOWN')).toBeInTheDocument();
  });

  it('renders infrastructure cards', () => {
    render(<HealthPage />);

    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('Message Bus')).toBeInTheDocument();
    expect(screen.getByText('S3/CDN')).toBeInTheDocument();
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('displays key metrics', () => {
    render(<HealthPage />);

    expect(screen.getByText('Active Users (24h)')).toBeInTheDocument();
    expect(screen.getByText('1,245')).toBeInTheDocument();
    expect(screen.getByText('API Requests (24h)')).toBeInTheDocument();
    expect(screen.getByText('125K')).toBeInTheDocument();
  });

  it('renders page heading', () => {
    render(<HealthPage />);

    expect(screen.getByRole('heading', { name: 'Health Dashboard' })).toBeInTheDocument();
  });

  it('shows metric detail text when present', () => {
    render(<HealthPage />);

    expect(screen.getByText('8,320 delivered (98.5%)')).toBeInTheDocument();
  });

  it('renders the loading state while the dashboard is still fetching', () => {
    mockIsLoading = true;
    mockData = undefined;

    render(<HealthPage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('API Gateway')).not.toBeInTheDocument();
  });
});
