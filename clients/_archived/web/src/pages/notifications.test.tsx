import { render, screen } from '@testing-library/react';
import { Component as NotificationsPage } from './notifications';

vi.mock('@/features/notifications/notification-centre-page', () => ({
  NotificationCentrePage: () => <div data-testid="notification-centre-page" />,
}));

describe('NotificationsPage', () => {
  it('renders NotificationCentrePage component', () => {
    render(<NotificationsPage />);
    expect(screen.getByTestId('notification-centre-page')).toBeInTheDocument();
  });
});
