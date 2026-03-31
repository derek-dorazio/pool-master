import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as TenantsPage } from './index';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockTenants = {
  items: [
    { id: 't-1', name: 'Acme Corp', plan: 'Pro', members: 45, leagues: 3, contests: 12, status: 'Active', lastActive: new Date().toISOString() },
    { id: 't-2', name: 'Beta League', plan: 'Free', members: 8, leagues: 1, contests: 2, status: 'Trial', lastActive: new Date().toISOString() },
    { id: 't-3', name: 'FanDraft', plan: 'League+', members: 120, leagues: 10, contests: 35, status: 'Suspended', lastActive: new Date().toISOString() },
  ],
  total: 3,
  page: 1,
  totalPages: 1,
};

vi.mock('@/hooks/use-admin-api', () => ({
  useTenantList: () => ({
    data: mockTenants,
    isLoading: false,
  }),
}));

function renderTenants() {
  return render(
    <MemoryRouter>
      <TenantsPage />
    </MemoryRouter>,
  );
}

describe('TenantsPage', () => {
  it('renders tenant table with tenant names', () => {
    renderTenants();

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Beta League')).toBeInTheDocument();
    expect(screen.getByText('FanDraft')).toBeInTheDocument();
  });

  it('shows plan badges', () => {
    renderTenants();

    // Use getAllByText since plan names also appear in filter dropdown options
    expect(screen.getAllByText('Pro').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Free').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('League+').length).toBeGreaterThanOrEqual(1);
  });

  it('shows status badges', () => {
    renderTenants();

    // Use getAllByText since status names also appear in filter dropdown options
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Trial').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Suspended').length).toBeGreaterThanOrEqual(1);
  });

  it('renders search input', () => {
    renderTenants();

    expect(screen.getByPlaceholderText('Search tenants...')).toBeInTheDocument();
  });

  it('renders filter dropdowns for plan and status', () => {
    renderTenants();

    expect(screen.getByDisplayValue('All Plans')).toBeInTheDocument();
    expect(screen.getByDisplayValue('All Statuses')).toBeInTheDocument();
  });

  it('shows total count badge', () => {
    renderTenants();

    expect(screen.getByText('3 total')).toBeInTheDocument();
  });
});
