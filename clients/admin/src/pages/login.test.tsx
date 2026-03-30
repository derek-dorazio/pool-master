import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as LoginPage } from './login';

const mockNavigate = vi.fn();
const mockSetAdminUser = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/stores/admin-auth-store', () => ({
  useAdminAuthStore: () => ({
    setAdminUser: mockSetAdminUser,
    setLoading: vi.fn(),
    isAuthenticated: false,
    isLoading: false,
  }),
}));

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email and password inputs', () => {
    renderLogin();

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('renders "Sign In" submit button', () => {
    renderLogin();

    expect(screen.getByRole('button', { name: /sign in$/i })).toBeInTheDocument();
  });

  it('renders SSO button', () => {
    renderLogin();

    expect(screen.getByRole('button', { name: /sign in with sso/i })).toBeInTheDocument();
  });

  it('renders admin branding/title', () => {
    renderLogin();

    expect(screen.getByText('Ultimate Pool Manager Admin')).toBeInTheDocument();
    expect(screen.getByText('Sign in to access the admin dashboard')).toBeInTheDocument();
  });
});
