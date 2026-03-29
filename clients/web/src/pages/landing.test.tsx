import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as LandingPage } from './landing';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: any) => selector({ isAuthenticated: false, isLoading: false }),
}));

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe('LandingPage', () => {
  it('renders hero heading', () => {
    renderLanding();
    expect(screen.getByTestId('hero-heading')).toBeInTheDocument();
  });

  it('renders Get Started CTA', () => {
    renderLanding();
    expect(screen.getByTestId('hero-cta')).toBeInTheDocument();
  });

  it('renders features section', () => {
    renderLanding();
    expect(screen.getByTestId('features-heading')).toBeInTheDocument();
  });

  it('renders supported sports', () => {
    renderLanding();
    expect(screen.getByText('NFL')).toBeInTheDocument();
    expect(screen.getByText('Golf')).toBeInTheDocument();
  });
});
