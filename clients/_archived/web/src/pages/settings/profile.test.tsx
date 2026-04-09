import { render, screen } from '@testing-library/react';
import { Component as ProfileSettingsPage } from './profile';

vi.mock('@/features/settings/profile-page', () => ({
  ProfilePage: () => <div data-testid="profile-page">Profile Page</div>,
}));

describe('ProfileSettingsPage', () => {
  it('renders the profile settings feature page', () => {
    render(<ProfileSettingsPage />);

    expect(screen.getByTestId('profile-page')).toBeInTheDocument();
  });
});
