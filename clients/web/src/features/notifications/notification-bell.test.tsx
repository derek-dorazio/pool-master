import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationBell } from './notification-bell';

const mockToggleDropdown = vi.fn();

vi.mock('./hooks/use-unread-count', () => ({
  useUnreadCount: vi.fn(),
}));

vi.mock('@/stores/notification-ui-store', () => ({
  useNotificationUiStore: vi.fn((selector: any) =>
    selector({ toggleDropdown: mockToggleDropdown, isDropdownOpen: false, setDropdownOpen: vi.fn() }),
  ),
}));

vi.mock('./unread-badge', () => ({
  UnreadBadge: ({ count }: { count: number }) =>
    count > 0 ? <span data-testid="unread-badge">{count}</span> : null,
}));

vi.mock('./notification-dropdown', () => ({
  NotificationDropdown: () => <div data-testid="notification-dropdown" />,
}));

import { useUnreadCount } from './hooks/use-unread-count';

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the bell button with aria-label', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { total: 0 } } as any);
    render(<NotificationBell />);
    expect(screen.getByRole('button', { name: /Notifications/i })).toBeInTheDocument();
  });

  it('shows unread count badge when count is > 0', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { total: 5 } } as any);
    render(<NotificationBell />);
    expect(screen.getByTestId('unread-badge')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('hides badge when unread count is 0', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { total: 0 } } as any);
    render(<NotificationBell />);
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
  });

  it('calls toggleDropdown when bell button is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(useUnreadCount).mockReturnValue({ data: { total: 0 } } as any);
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(mockToggleDropdown).toHaveBeenCalledTimes(1);
  });

  it('displays the aria-label with the unread count', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { total: 12 } } as any);
    render(<NotificationBell />);
    expect(screen.getByLabelText('Notifications, 12 unread')).toBeInTheDocument();
  });
});
