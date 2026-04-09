import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickActionsBar } from './quick-actions-bar';

vi.mock('./hooks/use-my-leagues', () => ({
  useMyLeagues: vi.fn(() => ({ data: [] })),
}));

import { useMyLeagues } from './hooks/use-my-leagues';

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <QuickActionsBar />
    </MemoryRouter>,
  );
}

describe('QuickActionsBar', () => {
  it('renders Create League, Join League, and Browse Contests links', () => {
    renderWithRouter();
    expect(screen.getByText('Create League')).toBeInTheDocument();
    expect(screen.getByText('Join League')).toBeInTheDocument();
    expect(screen.getByText('Browse Contests')).toBeInTheDocument();
  });

  it('links point to correct routes', () => {
    renderWithRouter();
    expect(screen.getByText('Create League').closest('a')).toHaveAttribute('href', '/leagues/create');
    expect(screen.getByText('Join League').closest('a')).toHaveAttribute('href', '/discover/leagues');
    expect(screen.getByText('Browse Contests').closest('a')).toHaveAttribute('href', '/discover/contests');
  });

  it('does not show Create Contest when user has no commissioner league', () => {
    renderWithRouter();
    expect(screen.queryByText('Create Contest')).not.toBeInTheDocument();
  });

  it('shows Create Contest when user has a commissioner league', () => {
    vi.mocked(useMyLeagues).mockReturnValue({ data: [{ role: 'Commissioner' }] } as any);
    renderWithRouter();
    expect(screen.getByText('Create Contest')).toBeInTheDocument();
    expect(screen.getByText('Create Contest').closest('a')).toHaveAttribute('href', '/contests/create');
  });
});
