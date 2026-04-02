import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  // --- Form validation tests ---

  it('clicking Next without selecting a sport shows validation error', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => {
      expect(screen.getByText('Select a sport')).toBeInTheDocument();
    });
    // Should remain on step 1
    expect(screen.getByText(/Step 1 of 7/)).toBeInTheDocument();
  });

  it('renders all 9 sport options from the SPORTS array', () => {
    renderPage();

    const expectedSports = ['NFL', 'NBA', 'Golf', 'F1', 'NCAA', 'Tennis', 'Soccer', 'NASCAR', 'Horse Racing'];
    for (const sport of expectedSports) {
      expect(screen.getByText(sport)).toBeInTheDocument();
    }
  });

  it('selecting a sport clears the sport validation error', async () => {
    const user = userEvent.setup();
    renderPage();

    // Trigger validation error
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => {
      expect(screen.getByText('Select a sport')).toBeInTheDocument();
    });

    // Select a sport — mode: onChange should clear the error
    await user.click(screen.getByText('Golf'));
    await waitFor(() => {
      expect(screen.queryByText('Select a sport')).not.toBeInTheDocument();
    });
  });

  it('selecting a sport and event then clicking Next advances to step 2', async () => {
    const user = userEvent.setup();
    renderPage();

    // Select sport
    await user.click(screen.getByText('NFL'));
    // Select event
    await user.click(screen.getByText('NFL Week 1 2026'));
    // Click Next
    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 7/)).toBeInTheDocument();
    });
    expect(screen.getByText('Contest Duration')).toBeInTheDocument();
  });

  it('form renders all wizard steps via step indicator', () => {
    const { container } = renderPage();

    // Step indicator should render 7 circles (one per step)
    const circles = container.querySelectorAll('.rounded-full');
    // At least 7 step circles rendered
    expect(circles.length).toBeGreaterThanOrEqual(7);

    // Also verify step label text
    expect(screen.getByText(/Step 1 of 7/)).toBeInTheDocument();
  });
});
