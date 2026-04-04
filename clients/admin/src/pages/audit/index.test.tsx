import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { Component as AuditLogPage } from './index';

const mockUseAuditLog = vi.fn();

vi.mock('@/hooks/use-audit-api', () => ({
  useAuditLog: (...args: unknown[]) => mockUseAuditLog(...args),
}));

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
  totalPages: 2,
};

function renderPage() {
  return render(<AuditLogPage />);
}

describe('AuditLogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuditLog.mockReturnValue({
      data: mockAuditData,
      isLoading: false,
    });
  });

  it('renders the audit log entries and expands a row for more detail', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('heading', { name: 'Audit Log' })).toBeInTheDocument();
    expect(screen.getByTestId('audit-entry-toggle-al-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/Suspended tenant Acme Corp/)).toBeInTheDocument();

    await user.click(screen.getByTestId('audit-entry-toggle-al-1'));

    expect(screen.getByTestId('audit-entry-toggle-al-1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Full Description')).toBeInTheDocument();
    expect(screen.getByText('Reason')).toBeInTheDocument();
    expect(screen.getByText('Before State')).toBeInTheDocument();
    expect(screen.getByText('After State')).toBeInTheDocument();
  });

  it('requests the next page when pagination advances', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('audit-pagination-next'));

    await waitFor(() => {
      expect(mockUseAuditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 2,
        }),
      );
    });
  });
});
