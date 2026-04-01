import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';

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

let capturedSetUser = vi.fn();

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: any) => {
    const store = {
      setUser: capturedSetUser,
      isAuthenticated: false,
      isLoading: false,
      user: null,
    };
    return selector(store);
  },
}));

const mockApiPost = vi.fn();

vi.mock('@/lib/api-client', () => ({
  api: { post: (...args: any[]) => mockApiPost(...args) },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

async function renderAndGetLoginPage() {
  const { Component: LoginPage } = await import('@/pages/auth/login');
  return render(
    createElement(
      MemoryRouter,
      null,
      createElement(LoginPage),
    ),
  );
}

describe('Auth Login Flow', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSetUser = vi.fn();
    localStorage.clear();
  });

  it('stores token in localStorage and sets user in auth store on successful login', async () => {
    mockApiPost.mockResolvedValue({
      token: 'test-jwt-token-123',
      user: { id: 'u-1', email: 'jane@example.com', displayName: 'Jane Doe' },
    });

    await renderAndGetLoginPage();

    const emailInput = screen.getByLabelText('fields.email');
    const passwordInput = screen.getByLabelText('fields.password');
    const submitBtn = screen.getByRole('button', { name: 'login.button' });

    await user.type(emailInput, 'jane@example.com');
    await user.type(passwordInput, 'securepassword');
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/auth/login', {
        email: 'jane@example.com',
        password: 'securepassword',
      });
    });

    await waitFor(() => {
      expect(localStorage.getItem('access_token')).toBe('test-jwt-token-123');
    });

    expect(capturedSetUser).toHaveBeenCalledWith({
      id: 'u-1',
      email: 'jane@example.com',
      displayName: 'Jane Doe',
    });
  });

  it('navigates to /dashboard after successful login', async () => {
    mockApiPost.mockResolvedValue({
      token: 'jwt-token',
      user: { id: 'u-1', email: 'jane@example.com', displayName: 'Jane Doe' },
    });

    await renderAndGetLoginPage();

    await user.type(screen.getByLabelText('fields.email'), 'jane@example.com');
    await user.type(screen.getByLabelText('fields.password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'login.button' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows error message on API rejection', async () => {
    const { ApiError } = await import('@/lib/api-client');
    mockApiPost.mockRejectedValue(new (ApiError as any)(401, 'Invalid credentials'));

    await renderAndGetLoginPage();

    await user.type(screen.getByLabelText('fields.email'), 'wrong@example.com');
    await user.type(screen.getByLabelText('fields.password'), 'badpassword');
    await user.click(screen.getByRole('button', { name: 'login.button' }));

    await waitFor(() => {
      expect(screen.getByText('errors.invalidCredentials')).toBeInTheDocument();
    });

    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('shows validation errors when submitting empty form', async () => {
    await renderAndGetLoginPage();

    await user.click(screen.getByRole('button', { name: 'login.button' }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
  });
});
