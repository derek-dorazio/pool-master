import { render, screen } from '@testing-library/react';
import { NotificationPreferencesPage } from './notification-preferences-page';

vi.mock('./preferences-matrix', () => ({
  PreferencesMatrix: () => <div data-testid="preferences-matrix" />,
}));

vi.mock('./dnd-scheduler', () => ({
  DNDScheduler: () => <div data-testid="dnd-scheduler" />,
}));

vi.mock('./hooks/use-push-permission', () => ({
  usePushPermission: vi.fn(),
}));

import { usePushPermission } from './hooks/use-push-permission';

describe('NotificationPreferencesPage', () => {
  beforeEach(() => {
    vi.mocked(usePushPermission).mockReturnValue({
      permission: 'granted',
      isSupported: true,
      isGranted: true,
      isDenied: false,
      isDefault: false,
      requestPermission: vi.fn(),
    } as any);
  });

  it('renders the active preferences controls', () => {
    render(<NotificationPreferencesPage />);

    expect(screen.getByRole('heading', { name: 'Notification Preferences' })).toBeInTheDocument();
    expect(screen.getByTestId('preferences-matrix')).toBeInTheDocument();
    expect(screen.getByTestId('dnd-scheduler')).toBeInTheDocument();
  });

  it('shows the blocked push warning when browser permission is denied', () => {
    vi.mocked(usePushPermission).mockReturnValue({
      permission: 'denied',
      isSupported: true,
      isGranted: false,
      isDenied: true,
      isDefault: false,
      requestPermission: vi.fn(),
    } as any);

    render(<NotificationPreferencesPage />);

    expect(screen.getByText('Push notifications are blocked')).toBeInTheDocument();
    expect(screen.getByText(/site notification settings/i)).toBeInTheDocument();
  });
});
