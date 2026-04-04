import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Component as TenantDetailPage } from './detail';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: 'tenant-1' }),
  };
});

interface MockTenant {
  tenant: { id: string; name: string; slug: string; planTier: string; createdAt: string; updatedAt: string; settings: Record<string, number> };
  status: string;
  lastActiveAt: string;
  memberCount: number;
  leagueCount: number;
  contestCount: number;
  activeContestCount: number;
  recentMembers: { id: string; displayName: string; email: string; createdAt: string }[];
  name: string;
  slug: string;
  plan: string;
  createdAt: string;
  updatedAt: string;
  statusLabel: string;
  lastActive: string;
}

const mockTenant: MockTenant = {
  tenant: {
    id: 'tenant-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
    planTier: 'pro',
    createdAt: '2025-06-15T00:00:00Z',
    updatedAt: '2026-03-20T00:00:00Z',
    settings: { maxLeagues: 10, maxMembers: 500 },
  },
  status: 'active',
  lastActiveAt: new Date().toISOString(),
  memberCount: 45,
  leagueCount: 3,
  contestCount: 12,
  activeContestCount: 4,
  recentMembers: [
    { id: 'user-1', displayName: 'Alice Johnson', email: 'alice@acme.com', createdAt: '2026-01-10T00:00:00Z' },
    { id: 'user-2', displayName: 'Bob Smith', email: 'bob@acme.com', createdAt: '2026-02-15T00:00:00Z' },
  ],
  name: 'Acme Corp',
  slug: 'acme-corp',
  plan: 'Pro',
  createdAt: '2025-06-15T00:00:00Z',
  updatedAt: '2026-03-20T00:00:00Z',
  statusLabel: 'Active',
  lastActive: new Date().toISOString(),
};

let mockTenantData: MockTenant | undefined = mockTenant;
let mockIsLoading = false;
let mockIsError = false;
let mockError: Error | undefined;

vi.mock('@/hooks/use-admin-api', () => ({
  useTenantDetail: () => ({
    data: mockTenantData,
    isLoading: mockIsLoading,
    isError: mockIsError,
    error: mockError,
  }),
}));

vi.mock('@/lib/api', () => ({
  client: {},
  adminSuspendTenant: vi.fn(),
  adminChangeTenantPlan: vi.fn(),
  adminApplyCredit: vi.fn(),
  adminExtendTrial: vi.fn(),
  adminDeleteTenant: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <TenantDetailPage />
    </MemoryRouter>,
  );
}

describe('TenantDetailPage', () => {
  beforeEach(() => {
    mockTenantData = mockTenant;
    mockIsLoading = false;
    mockIsError = false;
    mockError = undefined;
  });

  it('renders the loading state', () => {
    mockIsLoading = true;
    mockTenantData = undefined;
    renderPage();

    expect(screen.getByTestId('tenant-detail-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading tenant...')).toBeInTheDocument();
  });

  it('renders the error state when query fails', () => {
    mockIsError = true;
    mockTenantData = undefined;
    mockError = new Error('Tenant not found');
    renderPage();

    expect(screen.getByTestId('tenant-detail-error')).toBeInTheDocument();
    expect(screen.getByText(/Tenant detail is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Tenant not found/)).toBeInTheDocument();
  });

  it('renders the error state with default message when error is not an Error instance', () => {
    mockIsError = true;
    mockTenantData = undefined;
    mockError = undefined;
    renderPage();

    expect(screen.getByText(/Check the tenant ID/)).toBeInTheDocument();
  });

  it('renders tenant name in the header', () => {
    renderPage();

    expect(screen.getByTestId('tenant-detail-name')).toHaveTextContent('Acme Corp');
  });

  it('shows plan and status badges', () => {
    renderPage();

    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders the tenant summary card', () => {
    renderPage();

    expect(screen.getByText('Tenant Summary')).toBeInTheDocument();
    expect(screen.getByText('acme-corp')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders the settings snapshot card', () => {
    renderPage();

    expect(screen.getByText('Settings Snapshot')).toBeInTheDocument();
    expect(screen.getByText(/"maxLeagues": 10/)).toBeInTheDocument();
  });

  it('renders recent members list', () => {
    renderPage();

    expect(screen.getByText('Recent Members')).toBeInTheDocument();
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('alice@acme.com')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getByText('bob@acme.com')).toBeInTheDocument();
  });

  it('renders empty members state', () => {
    mockTenantData = { ...mockTenant, recentMembers: [] };
    renderPage();

    expect(screen.getByText('No members found for this tenant.')).toBeInTheDocument();
  });

  it('renders the actions dropdown button', () => {
    renderPage();

    expect(screen.getByTestId('tenant-detail-actions')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-detail-actions')).toHaveTextContent('Actions');
  });

  it('opens the actions menu on click', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('tenant-detail-actions'));

    expect(screen.getByText('Change Plan')).toBeInTheDocument();
    expect(screen.getByText('Suspend')).toBeInTheDocument();
    expect(screen.getByText('Apply Credit')).toBeInTheDocument();
    expect(screen.getByText('Extend Trial')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows Suspended status badge for suspended tenant', () => {
    mockTenantData = { ...mockTenant, statusLabel: 'Suspended' };
    renderPage();

    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('shows Trial status badge for trial tenant', () => {
    mockTenantData = { ...mockTenant, statusLabel: 'Trial' };
    renderPage();

    expect(screen.getByText('Trial')).toBeInTheDocument();
  });

  it('shows the confirm dialog when an action is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('tenant-detail-actions'));
    await user.click(screen.getByText('Suspend'));

    expect(screen.getByText(/Are you sure you want to Suspend/)).toBeInTheDocument();
  });

  it('shows destructive variant for delete action', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('tenant-detail-actions'));
    await user.click(screen.getByText('Delete'));

    expect(screen.getByText(/Are you sure you want to Delete/)).toBeInTheDocument();
  });

  it('renders the page-level data-testid', () => {
    renderPage();

    expect(screen.getByTestId('tenant-detail-page')).toBeInTheDocument();
  });
});
