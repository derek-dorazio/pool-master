import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as AnnouncementsPage } from './index';

const mockInvalidateQueries = vi.fn();
const mockActivateAnnouncement = vi.fn().mockResolvedValue({ data: { id: 'ann-2' } });
const mockDeactivateAnnouncement = vi.fn().mockResolvedValue({ data: { id: 'ann-1' } });
const mockUseAnnouncements = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

vi.mock('@/lib/api', () => ({
  client: {},
  adminActivateAnnouncement: (...args: unknown[]) => mockActivateAnnouncement(...args),
  adminDeactivateAnnouncement: (...args: unknown[]) => mockDeactivateAnnouncement(...args),
}));

vi.mock('@/hooks/use-announcements-api', () => ({
  useAnnouncements: (...args: unknown[]) => mockUseAnnouncements(...args),
}));

const announcements = [
  {
    id: 'ann-1',
    title: 'Maintenance Notice',
    body: 'We will pause scoring briefly tonight.',
    type: 'Banner' as const,
    severity: 'Warning' as const,
    target: 'ALL_USERS',
    status: 'Active' as const,
    startsAt: '2026-04-04T18:00:00.000Z',
    endsAt: null,
    dismissable: true,
  },
  {
    id: 'ann-2',
    title: 'Draft Launch',
    body: 'The draft starts in 10 minutes.',
    type: 'Notification' as const,
    severity: 'Info' as const,
    target: 'SPECIFIC_TENANTS',
    status: 'Scheduled' as const,
    startsAt: '2026-04-05T18:00:00.000Z',
    endsAt: null,
    dismissable: false,
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <AnnouncementsPage />
    </MemoryRouter>,
  );
}

describe('AnnouncementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAnnouncements.mockReturnValue({
      data: announcements,
      isLoading: false,
    });
  });

  it('renders the announcements list and create link', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Global Announcements' })).toBeInTheDocument();
    expect(screen.getByTestId('announcements-create-link')).toBeInTheDocument();
    expect(screen.getByText('Maintenance Notice')).toBeInTheDocument();
    expect(screen.getByText('Draft Launch')).toBeInTheDocument();
  });

  it('toggles active and scheduled announcements through the SDK', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('announcement-toggle-ann-1'));
    await user.click(screen.getByTestId('announcement-toggle-ann-2'));

    await waitFor(() => {
      expect(mockDeactivateAnnouncement).toHaveBeenCalledWith({
        client: {},
        path: { id: 'ann-1' },
      });
      expect(mockActivateAnnouncement).toHaveBeenCalledWith({
        client: {},
        path: { id: 'ann-2' },
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['announcements'] });
    });
  });
});
