import { render, screen } from '@testing-library/react';
import { BulkActions } from './bulk-actions';

vi.mock('./hooks/use-notification-actions', () => ({
  useMarkAllAsRead: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('./hooks/use-unread-count', () => ({
  useUnreadCount: vi.fn(() => ({
    data: {
      total: 5,
      grouped: {
        draft: 2,
        scoring: 1,
        contest: 1,
        league: 1,
        social: 0,
        account: 0,
      },
    },
  })),
}));

vi.mock('@/stores/notification-ui-store', () => ({
  useNotificationUiStore: vi.fn((selector: (s: any) => any) =>
    selector({ activeCategory: null }),
  ),
}));

describe('BulkActions', () => {
  it('displays unread count', () => {
    render(<BulkActions />);

    expect(screen.getByText('5 unread')).toBeInTheDocument();
  });

  it('renders Mark All Read button', () => {
    render(<BulkActions />);

    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeInTheDocument();
  });

  it('shows "No unread notifications" when count is 0', async () => {
    const { useUnreadCount } = await import('./hooks/use-unread-count');
    vi.mocked(useUnreadCount).mockReturnValue({
      data: { total: 0, grouped: {} },
    } as any);

    render(<BulkActions />);

    expect(screen.getByText('No unread notifications')).toBeInTheDocument();
  });
});
