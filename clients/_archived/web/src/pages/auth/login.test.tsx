import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Component as LoginPage } from './login';

// Radix Checkbox uses ResizeObserver which jsdom does not provide
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

const { mockNavigate, mockSetUser, mockLoginUser } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSetUser: vi.fn(),
  mockLoginUser: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: any) =>
    selector({ setUser: mockSetUser, isAuthenticated: false, isLoading: false }),
}));

vi.mock('@/lib/api', () => ({
  client: {},
  loginUser: mockLoginUser,
}));

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders email and password inputs', () => {
    renderLogin();
    expect(screen.getByLabelText('fields.email')).toBeInTheDocument();
    expect(screen.getByLabelText('fields.password')).toBeInTheDocument();
  });

  it('renders stable automation selectors', () => {
    renderLogin();
    expect(screen.getByTestId('auth-login-card')).toBeInTheDocument();
    expect(screen.getByTestId('auth-login-title')).toBeInTheDocument();
    expect(screen.getByTestId('auth-login-submit')).toBeInTheDocument();
  });

  it('renders social login buttons (Google, Apple)', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: 'social.continueWithGoogle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'social.continueWithApple' })).toBeInTheDocument();
  });

  it('renders link to register page', () => {
    renderLogin();
    const link = screen.getByRole('link', { name: 'login.signUp' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/register');
  });

  it('renders "Forgot password?" link', () => {
    renderLogin();
    const link = screen.getByRole('link', { name: 'login.forgotPassword' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/forgot-password');
  });

  it('preserves redirectTo in auth links when present', () => {
    renderLogin('/login?redirectTo=%2Fjoin%2Finvite-123');
    expect(screen.getByRole('link', { name: 'login.signUp' })).toHaveAttribute(
      'href',
      '/register?redirectTo=%2Fjoin%2Finvite-123',
    );
    expect(screen.getByRole('link', { name: 'login.forgotPassword' })).toHaveAttribute(
      'href',
      '/forgot-password?redirectTo=%2Fjoin%2Finvite-123',
    );
  });

  it('shows validation errors on empty submit', async () => {
    const user = userEvent.setup();
    renderLogin();
    const submitBtn = screen.getByTestId('auth-login-submit');
    await user.click(submitBtn);
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('submits successfully and navigates to the requested redirect', async () => {
    const user = userEvent.setup();
    mockLoginUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'test@example.com',
          displayName: 'Test User',
          avatarUrl: null,
        },
        tokens: {
          accessToken: 'token-123',
        },
      },
      error: undefined,
    });

    renderLogin('/login?redirectTo=%2Fjoin%2Finvite-123');

    await user.type(screen.getByLabelText('fields.email'), 'test@example.com');
    await user.type(screen.getByLabelText('fields.password'), 'Password123!');
    await user.click(screen.getByTestId('auth-login-submit'));

    await waitFor(() => {
      expect(mockLoginUser).toHaveBeenCalledWith({
        client: {},
        body: {
          email: 'test@example.com',
          password: 'Password123!',
        },
      });
    });

    expect(localStorage.getItem('access_token')).toBe('token-123');
    expect(mockSetUser).toHaveBeenCalledWith({
      id: 'user-1',
      email: 'test@example.com',
      displayName: 'Test User',
      avatarUrl: undefined,
    });
    expect(mockNavigate).toHaveBeenCalledWith('/join/invite-123');
  });

  it('shows invalid credentials for 401 responses', async () => {
    const user = userEvent.setup();
    mockLoginUser.mockResolvedValue({
      data: undefined,
      error: { statusCode: 401 },
    });

    renderLogin();

    await user.type(screen.getByLabelText('fields.email'), 'test@example.com');
    await user.type(screen.getByLabelText('fields.password'), 'Password123!');
    await user.click(screen.getByTestId('auth-login-submit'));

    expect(await screen.findByText('errors.invalidCredentials')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the generic server error for non-401 failures', async () => {
    const user = userEvent.setup();
    mockLoginUser.mockRejectedValue(new Error('network down'));

    renderLogin();

    await user.type(screen.getByLabelText('fields.email'), 'test@example.com');
    await user.type(screen.getByLabelText('fields.password'), 'Password123!');
    await user.click(screen.getByTestId('auth-login-submit'));

    expect(
      await screen.findByText('Unable to connect to server. Please try again later.'),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
