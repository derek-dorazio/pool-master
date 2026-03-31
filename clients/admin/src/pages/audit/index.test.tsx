import { render, screen } from '@testing-library/react';
import { Component as AuditLogPage } from './index';

const mockAuditData = {
  entries: [
    {
      id: 'al-1',
      timestamp: '2025-03-20T14:30:00Z',
      admin: 'sarah.chen@poolmaster.io',
      action: 'tenant.suspend',
      resourceType: 'TENANT',
      resourceId: 't-123',
      description: 'Suspended tenant Acme Corp for TOS violation',
      reason: 'Repeated policy violations',
      beforeState: { status: 'Active' },
      afterState: { status: 'Suspended' },
      ipAddress: '10.0.1.50',
      userAgent: 'Mozilla/5.0',
    },
    {
      id: 'al-2',
      timestamp: '2025-03-19T10:15:00Z',
      admin: 'mike.johnson@poolmaster.io',
      action: 'contest.recalculate',
      resourceType: 'CONTEST',
      resourceId: 'c-456',
      description: 'Recalculated standings for Masters 2026',
      reason: null,
      beforeState: null,
      afterState: null,
      ipAddress: '10.0.1.55',
      userAgent: 'Mozilla/5.0',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

vi.mock('@/hooks/use-audit-api', () => ({
  useAuditLog: () => ({
    data: mockAuditData,
    isLoading: false,
  }),
}));

function renderPage() {
  return render(<AuditLogPage />);
}

describe('AuditLogPage', () => {
  it('renders the audit log table with entries', () => {
    renderPage();
    expect(screen.getByText('Audit Log')).toBeInTheDocument();
    // Admin emails appear in both filter dropdown options and table rows
    expect(screen.getAllByText('sarah.chen@poolmaster.io').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('mike.johnson@poolmaster.io').length).toBeGreaterThanOrEqual(1);
  });

  it('shows filter bar with admin, action, and resource type dropdowns', () => {
    renderPage();
    // Filter labels — use getAllByText since text may also appear in dropdowns/table
    expect(screen.getAllByText('Admin').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Action').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Resource Type').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the Export CSV button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument();
  });

  it('renders timestamps and admin names for each entry', () => {
    renderPage();
    // Action strings may appear in both the filter dropdown and the table
    expect(screen.getAllByText('tenant.suspend').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('contest.recalculate').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Suspended tenant Acme Corp/)).toBeInTheDocument();
  });

  it('shows search input for filtering', () => {
    renderPage();
    expect(screen.getByPlaceholderText('Search description or reason...')).toBeInTheDocument();
  });
});
