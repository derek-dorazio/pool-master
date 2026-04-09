import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsHub } from './settings-hub';

vi.mock('@/features/notifications/hooks/use-unread-count', () => ({
  useUnreadCount: () => ({
    data: { total: 3 },
  }),
}));

function renderHub() {
  return render(
    <MemoryRouter>
      <SettingsHub />
    </MemoryRouter>,
  );
}

describe('SettingsHub', () => {
  it('links into the active profile, timezone, and privacy settings surfaces', () => {
    renderHub();

    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/settings/profile');
    expect(screen.getByRole('link', { name: /timezone & locale/i })).toHaveAttribute('href', '/settings/timezone');
    expect(screen.getByRole('link', { name: /privacy & data/i })).toHaveAttribute('href', '/settings/privacy');
    expect(screen.getByText('3 unread')).toBeInTheDocument();
  }, 10_000);
});
