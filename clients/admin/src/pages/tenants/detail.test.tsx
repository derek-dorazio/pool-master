import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as TenantDetailPage } from './detail';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'tenant-123' }),
  };
});

const mockTenant = {
  id: 'tenant-123',
  name: 'Acme Sports League',
  slug: 'acme-sports',
  plan: 'Pro',
  status: 'Active',
  createdAt: '2025-01-15T00:00:00Z',
  lastActive: new Date().toISOString(),
  usage: {
    leagues: { current: 3, limit: 10 },
    contests: { current: 8, limit: 50 },
    members: { current: 25, limit: 100 },
  },
  recentSignups: [
    { email: 'user1@example.com', date: '2025-03-01T00:00:00Z' },
    { email: 'user2@example.com', date: '2025-03-05T00:00:00Z' },
  ],
  membersList: [
    { id: 'm-1', email: 'admin@acme.com', displayName: 'Admin User', role: 'Owner', lastActive: new Date().toISOString() },
  ],
  leaguesList: [
    { id: 'l-1', name: 'Sunday Picks', sport: 'NFL', members: 12, contests: 3 },
  ],
  contestsList: [
    { id: 'c-1', name: 'Masters 2026', sport: 'Golf', type: 'Single Event', status: 'Active', entries: 8 },
  ],
  activity: [
    { id: 'a-1', action: 'League Created', description: 'Sunday Picks league was created', timestamp: new Date().toISOString() },
  ],
};

vi.mock('@/hooks/use-admin-api', () => ({
  useTenantDetail: () => ({
    data: mockTenant,
    isLoading: false,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  adminApi: { post: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <TenantDetailPage />
    </MemoryRouter>,
  );
}

describe('TenantDetailPage', () => {
  it('renders tenant name in the header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Acme Sports League' })).toBeInTheDocument();
  });

  it('shows tabs for Overview, Members, Leagues, Contests, and Activity', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Leagues' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Contests' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument();
  });

  it('shows an Actions dropdown button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Actions/i })).toBeInTheDocument();
  });

  it('shows plan badge with the correct plan', () => {
    renderPage();
    expect(screen.getAllByText('Pro').length).toBeGreaterThanOrEqual(1);
  });

  it('shows status badge', () => {
    renderPage();
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
  });
});
