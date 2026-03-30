import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RoleGuard } from './role-guard';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ leagueId: 'test-league' }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: any) => selector({ user: { id: 'user-1' } })),
}));

import { useQuery } from '@tanstack/react-query';

describe('RoleGuard', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders children when user has sufficient role', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: 'COMMISSIONER',
      isLoading: false,
    } as any);

    render(
      <MemoryRouter>
        <RoleGuard allowedRoles={['OWNER', 'COMMISSIONER']}>
          <p>Protected Content</p>
        </RoleGuard>
      </MemoryRouter>,
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not render children when role is insufficient and navigates away', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: 'VIEWER',
      isLoading: false,
    } as any);

    render(
      <MemoryRouter>
        <RoleGuard allowedRoles={['OWNER', 'COMMISSIONER']}>
          <p>Protected Content</p>
        </RoleGuard>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith('/leagues/test-league', { replace: true });
  });

  it('redirects to custom path when redirectTo is specified', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: 'VIEWER',
      isLoading: false,
    } as any);

    render(
      <MemoryRouter>
        <RoleGuard allowedRoles={['OWNER']} redirectTo="/unauthorized">
          <p>Protected Content</p>
        </RoleGuard>
      </MemoryRouter>,
    );

    expect(mockNavigate).toHaveBeenCalledWith('/unauthorized', { replace: true });
  });

  it('shows loading spinner while role is being fetched', () => {
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    const { container } = render(
      <MemoryRouter>
        <RoleGuard allowedRoles={['OWNER']}>
          <p>Protected Content</p>
        </RoleGuard>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });
});
