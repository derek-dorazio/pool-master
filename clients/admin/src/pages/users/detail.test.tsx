import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as UserDetailPage } from './detail';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'user-456' }),
  };
});

const mockUser = {
  id: 'user-456',
  displayName: 'Jane Doe',
  email: 'jane@example.com',
  status: 'Active',
  authProvider: 'Email',
  createdAt: '2025-02-10T00:00:00Z',
  lastLogin: '2025-03-20T12:00:00Z',
  locale: 'en-US',
  tenantMemberships: [
    { tenantId: 't-1', tenantName: 'Acme Corp', role: 'Owner' },
  ],
  leagueMemberships: [
    { leagueId: 'l-1', leagueName: 'Sunday Picks', sport: 'NFL', role: 'Commissioner' },
  ],
  contests: [
    { id: 'c-1', name: 'Masters 2026', sport: 'Golf', status: 'Active', rank: 3 },
  ],
  devices: [
    { id: 'd-1', platform: 'iOS', lastActive: new Date().toISOString(), tokenStatus: 'Valid' },
  ],
  authEvents: [
    { id: 'ae-1', type: 'login', timestamp: new Date().toISOString(), ip: '192.168.1.1', success: true },
  ],
};

vi.mock('@/hooks/use-admin-api', () => ({
  useUserDetail: () => ({
    data: mockUser,
    isLoading: false,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  adminApi: { post: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <UserDetailPage />
    </MemoryRouter>,
  );
}

describe('UserDetailPage', () => {
  it('renders user display name and email', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getAllByText('jane@example.com').length).toBeGreaterThanOrEqual(1);
  });

  it('shows tabs for Overview, Tenants & Leagues, Contests, Devices, and Auth Events', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tenants & Leagues' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Contests' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Devices' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Auth Events' })).toBeInTheDocument();
  });

  it('shows an Actions dropdown button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Actions/i })).toBeInTheDocument();
  });

  it('shows status badge with correct value', () => {
    renderPage();
    // Status badge appears in the header
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
  });

  it('displays the user ID in the header', () => {
    renderPage();
    expect(screen.getAllByText('user-456').length).toBeGreaterThanOrEqual(1);
  });
});
