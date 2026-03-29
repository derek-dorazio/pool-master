import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as LandingPage } from './landing';

// Mock dependencies
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
    expect(screen.getByText(/Run Your Pool/)).toBeInTheDocument();
    expect(screen.getByText(/Like a Pro/)).toBeInTheDocument();
  });

  it('renders Get Started CTA', () => {
    renderLanding();
    expect(screen.getByText('Get Started Free')).toBeInTheDocument();
  });

  it('renders feature cards', () => {
    renderLanding();
    expect(screen.getByText('Live Scoring')).toBeInTheDocument();
    expect(screen.getByText('Commissioner Tools')).toBeInTheDocument();
    expect(screen.getByText('League History')).toBeInTheDocument();
  });

  it('renders supported sports', () => {
    renderLanding();
    expect(screen.getByText('NFL')).toBeInTheDocument();
    expect(screen.getByText('Golf')).toBeInTheDocument();
    expect(screen.getByText('F1')).toBeInTheDocument();
  });

  it('renders social proof stats', () => {
    renderLanding();
    expect(screen.getByText('Free to start')).toBeInTheDocument();
    expect(screen.getByText('9 sports supported')).toBeInTheDocument();
  });
});
