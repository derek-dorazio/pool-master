import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as FlagDetailPage } from './detail';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ flagKey: 'enable_live_scoring' }),
  };
});

const mockFlag = {
  key: 'enable_live_scoring',
  name: 'Live Scoring',
  description: 'Enable real-time score updates during active contests',
  type: 'Percentage' as const,
  enabled: true,
  rolloutPct: 75,
  owner: 'engineering@poolmaster.io',
  created: 'Jan 15, 2025',
  lastUpdated: 'Mar 20, 2025',
  overrides: [
    { tenantName: 'Acme Corp', override: true, reason: 'Beta tester', setBy: 'admin@poolmaster.io', setAt: 'Feb 1, 2025' },
    { tenantName: 'Test Org', override: false, reason: 'Excluded from beta', setBy: 'admin@poolmaster.io', setAt: 'Feb 5, 2025' },
  ],
};

vi.mock('@/hooks/use-flags-api', () => ({
  useFlagDetail: () => ({
    data: mockFlag,
    isLoading: false,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  adminApi: {
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <FlagDetailPage />
    </MemoryRouter>,
  );
}

describe('FlagDetailPage', () => {
  it('renders the flag key in the header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'enable_live_scoring' })).toBeInTheDocument();
  });

  it('shows the global toggle switch', () => {
    renderPage();
    // The Toggle component renders with role="switch"
    const toggles = screen.getAllByRole('switch');
    expect(toggles.length).toBeGreaterThanOrEqual(1);
  });

  it('shows the rollout percentage section for Percentage type flags', () => {
    renderPage();
    expect(screen.getByText('Rollout Percentage')).toBeInTheDocument();
  });

  it('shows the overrides table with tenant overrides', () => {
    renderPage();
    expect(screen.getByText('Tenant Overrides')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Test Org')).toBeInTheDocument();
    expect(screen.getByText('2 overrides configured')).toBeInTheDocument();
  });

  it('shows the resolution tester section', () => {
    renderPage();
    expect(screen.getByText('Resolution Tester')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter tenant ID or name...')).toBeInTheDocument();
  });
});
