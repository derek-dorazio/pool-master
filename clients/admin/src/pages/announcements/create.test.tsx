import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as AnnouncementCreatePage } from './create';

const mockNavigate = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockCreateAnnouncement = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

vi.mock('@/lib/api', () => ({
  client: {},
  adminCreateAnnouncement: (...args: unknown[]) => mockCreateAnnouncement(...args),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <AnnouncementCreatePage />
    </MemoryRouter>,
  );
}

describe('AnnouncementCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAnnouncement.mockResolvedValue({ data: { id: 'ann-9' } });
  });

  it('keeps publish disabled until the required fields are filled', () => {
    renderPage();

    expect(screen.getByTestId('announcement-publish')).toBeDisabled();
  });

  it('submits the announcement payload through the SDK and returns to the list', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('radio', { name: 'Both' }));
    await user.click(screen.getByRole('radio', { name: 'Critical' }));
    await user.click(screen.getByRole('radio', { name: 'Specific Tenants' }));

    await user.type(screen.getByLabelText(/title/i), 'System Alert');
    await user.type(screen.getByLabelText(/body/i), 'Maintenance starts soon.');
    await user.type(screen.getByLabelText(/link url/i), 'https://example.com/status');
    await user.type(screen.getByLabelText(/link text/i), 'Status page');
    await user.type(screen.getByLabelText(/tenant ids/i), 'tenant-a, tenant-b');
    fireEvent.change(screen.getByLabelText(/starts at/i), {
      target: { value: '2026-04-04T18:00' },
    });
    fireEvent.change(screen.getByLabelText(/ends at/i), {
      target: { value: '2026-04-04T20:00' },
    });

    await user.click(screen.getByTestId('announcement-publish'));

    await waitFor(() => {
      expect(mockCreateAnnouncement).toHaveBeenCalledWith({
        client: {},
        body: {
          type: 'BOTH',
          title: 'System Alert',
          body: 'Maintenance starts soon.',
          linkUrl: 'https://example.com/status',
          linkText: 'Status page',
          severity: 'CRITICAL',
          dismissable: true,
          target: 'SPECIFIC_TENANTS',
          targetTenantIds: ['tenant-a', 'tenant-b'],
          startsAt: '2026-04-04T22:00:00.000Z',
          endsAt: '2026-04-05T00:00:00.000Z',
        },
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['announcements'] });
      expect(mockNavigate).toHaveBeenCalledWith('/announcements');
    });
  }, 10000);
});
