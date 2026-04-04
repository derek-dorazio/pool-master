import { render, screen } from '@testing-library/react';
import { Component as PrivacyPage } from './privacy';

vi.mock('@/features/settings/consent-manager', () => ({
  ConsentManager: () => <div data-testid="consent-manager">Consent Manager</div>,
}));
vi.mock('@/features/settings/ccpa-toggle', () => ({
  CCPAToggle: () => <div data-testid="ccpa-toggle">CCPA Toggle</div>,
}));
vi.mock('@/features/settings/data-export-card', () => ({
  DataExportCard: () => <div data-testid="data-export-card">Data Export</div>,
}));
vi.mock('@/features/settings/cookie-preferences', () => ({
  CookiePreferencesCard: () => <div data-testid="cookie-preferences-card">Cookie Preferences</div>,
}));
vi.mock('@/features/settings/self-exclusion-dialog', () => ({
  SelfExclusionCard: () => <div data-testid="self-exclusion-card">Self Exclusion</div>,
}));
vi.mock('@/features/settings/session-reminder-card', () => ({
  SessionReminderCard: () => <div data-testid="session-reminder-card">Session Reminder</div>,
}));
vi.mock('@/features/settings/activity-limit-card', () => ({
  ActivityLimitCard: () => <div data-testid="activity-limit-card">Activity Limit</div>,
}));
vi.mock('@/features/settings/account-deletion-card', () => ({
  AccountDeletionCard: () => <div data-testid="account-deletion-card">Account Deletion</div>,
}));

function renderPage() {
  return render(<PrivacyPage />);
}

describe('PrivacyPage', () => {
  it('renders the active privacy, gaming, and deletion sections', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Privacy & Data', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Responsible Gaming', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Danger Zone', level: 2 })).toBeInTheDocument();

    expect(screen.getByTestId('consent-manager')).toBeInTheDocument();
    expect(screen.getByTestId('data-export-card')).toBeInTheDocument();
    expect(screen.getByTestId('self-exclusion-card')).toBeInTheDocument();
    expect(screen.getByTestId('session-reminder-card')).toBeInTheDocument();
    expect(screen.getByTestId('activity-limit-card')).toBeInTheDocument();
    expect(screen.getByTestId('account-deletion-card')).toBeInTheDocument();
  });
});
