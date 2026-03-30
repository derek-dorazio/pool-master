import { render, screen } from '@testing-library/react';
import { Component as SettingsPage } from './index';

vi.mock('@/features/settings/settings-hub', () => ({
  SettingsHub: () => <div data-testid="settings-hub" />,
}));

describe('SettingsPage', () => {
  it('renders SettingsHub component', () => {
    render(<SettingsPage />);
    expect(screen.getByTestId('settings-hub')).toBeInTheDocument();
  });
});
