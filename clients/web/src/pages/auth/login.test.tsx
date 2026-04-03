import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as LoginPage } from './login';

// Radix Checkbox uses ResizeObserver which jsdom does not provide
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: any) =>
    selector({ setUser: vi.fn(), isAuthenticated: false, isLoading: false }),
}));

vi.mock('@/lib/api-client', () => ({
  api: { post: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
    }
  },
}));

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('renders email and password inputs', () => {
    renderLogin();
    expect(screen.getByLabelText('fields.email')).toBeInTheDocument();
    expect(screen.getByLabelText('fields.password')).toBeInTheDocument();
  });

  it('renders "Log In" submit button', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: 'login.button' })).toBeInTheDocument();
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
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    renderLogin();
    const submitBtn = screen.getByRole('button', { name: 'login.button' });
    await user.click(submitBtn);
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
  });
});
