import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { Component as CreateLeaguePage } from './create';

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
      <CreateLeaguePage />
    </MemoryRouter>,
  );
}

describe('CreateLeaguePage', () => {
  it('renders step indicator with 3 steps', () => {
    renderPage();
    expect(screen.getByText('Basics')).toBeInTheDocument();
    expect(screen.getByText('Access')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('step 1 has league name input', () => {
    renderPage();
    expect(screen.getByLabelText('League Name')).toBeInTheDocument();
  });

  it('renders "Next" button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Next/ })).toBeInTheDocument();
  });

  it('has "Back" button disabled on step 1 and enabled on step 2', async () => {
    const user = userEvent.setup();
    renderPage();

    const backBtn = screen.getByRole('button', { name: /Back/ });
    expect(backBtn).toBeDisabled();

    // Fill required name and go to step 2
    await user.type(screen.getByLabelText('League Name'), 'My Test League');
    await user.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByRole('button', { name: /Back/ })).toBeEnabled();
  });
});
