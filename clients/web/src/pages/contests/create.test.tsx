import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as CreateContestPage } from './create';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/lib/api-client', () => ({
  api: { post: vi.fn() },
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <CreateContestPage />
    </MemoryRouter>,
  );
}

describe('CreateContestPage', () => {
  it('renders step indicator', () => {
    const { container } = renderPage();
    // 7-step wizard renders 7 step circles
    const stepCircles = container.querySelectorAll('.rounded-full.h-8.w-8');
    expect(stepCircles.length).toBe(7);
  });

  it('step 1 has sport selector grid', () => {
    renderPage();
    expect(screen.getByText('Select Sport')).toBeInTheDocument();
    expect(screen.getByText('NFL')).toBeInTheDocument();
    expect(screen.getByText('NBA')).toBeInTheDocument();
    expect(screen.getByText('Golf')).toBeInTheDocument();
  });

  it('renders "Next" button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Next/ })).toBeInTheDocument();
  });

  it('shows step count', () => {
    renderPage();
    expect(screen.getByText(/Step 1 of 7/)).toBeInTheDocument();
  });
});
