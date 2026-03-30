import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationItem } from './notification-item';
import type { Notification } from './hooks/use-notifications';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('./hooks/use-notification-actions', () => ({
  useMarkAsRead: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

const unreadNotification: Notification = {
  id: 'n-1',
  category: 'draft',
  title: 'Draft Starting Soon',
  body: 'Your NFL Fantasy Draft begins in 15 minutes.',
  read: false,
  targetUrl: '/drafts/draft-1',
  createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
};

const readNotification: Notification = {
  id: 'n-2',
  category: 'scoring',
  title: 'Score Update',
  body: 'Your entry moved up to 2nd place.',
  read: true,
  targetUrl: '/contests/contest-2/standings',
  createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('NotificationItem', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders title and body text', () => {
    renderWithRouter(<NotificationItem notification={unreadNotification} />);

    expect(screen.getByText('Draft Starting Soon')).toBeInTheDocument();
    expect(screen.getByText('Your NFL Fantasy Draft begins in 15 minutes.')).toBeInTheDocument();
  });

  it('shows unread indicator for unread notifications', () => {
    renderWithRouter(<NotificationItem notification={unreadNotification} />);

    const button = screen.getByRole('article');
    // Unread notifications have bg-accent/40 class and a colored dot
    expect(button.className).toContain('bg-accent/40');
  });

  it('does not show unread indicator for read notifications', () => {
    renderWithRouter(<NotificationItem notification={readNotification} />);

    const button = screen.getByRole('article');
    expect(button.className).not.toContain('bg-accent/40');
  });

  it('has correct aria-label for unread notification', () => {
    renderWithRouter(<NotificationItem notification={unreadNotification} />);

    expect(screen.getByLabelText('unread Draft Starting Soon')).toBeInTheDocument();
  });

  it('has correct aria-label for read notification', () => {
    renderWithRouter(<NotificationItem notification={readNotification} />);

    expect(screen.getByLabelText('Score Update')).toBeInTheDocument();
  });
});
