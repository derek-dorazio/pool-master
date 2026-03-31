import { render, screen } from '@testing-library/react';
import { Component as PrivacyPage } from './privacy';

vi.mock('@/features/settings/privacy-page', () => ({
  PrivacyPage: () => (
    <div>
      <h1 className="text-3xl font-bold">Privacy & Data</h1>
      <div data-testid="consent-manager">Consent Manager</div>
      <div data-testid="data-export-card">Data Export</div>
      <div data-testid="account-deletion-card">Account Deletion</div>
    </div>
  ),
}));

function renderPage() {
  return render(<PrivacyPage />);
}

describe('PrivacyPage', () => {
  it('renders data export card', () => {
    renderPage();
    expect(screen.getByTestId('data-export-card')).toBeInTheDocument();
  });

  it('renders account deletion card', () => {
    renderPage();
    expect(screen.getByTestId('account-deletion-card')).toBeInTheDocument();
  });

  it('renders consent manager', () => {
    renderPage();
    expect(screen.getByTestId('consent-manager')).toBeInTheDocument();
  });
});
