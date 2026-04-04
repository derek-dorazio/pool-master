import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as ProvidersPage } from './index';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockProviders = [
  { providerId: 'espn', providerName: 'ESPN', status: 'HEALTHY' as const, errorRate: 0.3, latencyMs: 120, lastEventAt: '2026-04-03T18:00:00Z', activeEventCount: 14 },
  { providerId: 'yahoo', providerName: 'Yahoo Sports', status: 'DEGRADED' as const, errorRate: 6.2, latencyMs: 850, lastEventAt: '2026-04-03T17:30:00Z', activeEventCount: 5 },
  { providerId: 'cbs', providerName: 'CBS Sports', status: 'DOWN' as const, errorRate: 45.0, latencyMs: 3200, lastEventAt: null, activeEventCount: 0 },
];

let mockProviderData = mockProviders;
let mockIsError = false;
let mockError: Error | undefined;

vi.mock('@/hooks/use-providers-api', () => ({
  useProviderList: () => ({
    data: mockProviderData,
    isError: mockIsError,
    error: mockError,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ProvidersPage />
    </MemoryRouter>,
  );
}

describe('ProvidersPage', () => {
  beforeEach(() => {
    mockProviderData = mockProviders;
    mockIsError = false;
    mockError = undefined;
    mockNavigate.mockClear();
  });

  it('renders the page heading', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Sports Data Providers' })).toBeInTheDocument();
  });

  it('renders provider names in the table', () => {
    renderPage();

    expect(screen.getByText('ESPN')).toBeInTheDocument();
    expect(screen.getByText('Yahoo Sports')).toBeInTheDocument();
    expect(screen.getByText('CBS Sports')).toBeInTheDocument();
  });

  it('shows status badges for each provider', () => {
    renderPage();

    expect(screen.getByText('HEALTHY')).toBeInTheDocument();
    expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    expect(screen.getByText('DOWN')).toBeInTheDocument();
  });

  it('displays provider health summary', () => {
    renderPage();

    expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/providers healthy/)).toBeInTheDocument();
  });

  it('shows error rate values', () => {
    renderPage();

    expect(screen.getByText('0.3%')).toBeInTheDocument();
    expect(screen.getByText('6.2%')).toBeInTheDocument();
    expect(screen.getByText('45.0%')).toBeInTheDocument();
  });

  it('shows "No events yet" for providers without lastEventAt', () => {
    renderPage();

    expect(screen.getByText('No events yet')).toBeInTheDocument();
  });

  it('renders the error state', () => {
    mockIsError = true;
    mockProviderData = [];
    mockError = new Error('Service unavailable');
    renderPage();

    expect(screen.getByText(/Provider status is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Service unavailable/)).toBeInTheDocument();
  });

  it('renders the auto-refresh countdown', () => {
    renderPage();

    expect(screen.getByText(/Refreshing every 30s/)).toBeInTheDocument();
  });
});
