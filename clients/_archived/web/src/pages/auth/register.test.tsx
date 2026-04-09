import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Component as RegisterPage } from './register';

// Radix Checkbox uses ResizeObserver which jsdom does not provide
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

const { mockNavigate, mockSetUser, mockRegisterUser } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSetUser: vi.fn(),
  mockRegisterUser: vi.fn(),
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
  registerUser: mockRegisterUser,
}));

function renderRegister(initialEntry = '/register') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RegisterPage />
    </MemoryRouter>,
  );
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders step 1 with email and password fields', () => {
    renderRegister();
    expect(screen.getByLabelText('fields.email')).toBeInTheDocument();
    expect(screen.getByLabelText('fields.password')).toBeInTheDocument();
    expect(screen.getByLabelText('fields.confirmPassword')).toBeInTheDocument();
  });

  it('renders stable automation selectors', () => {
    renderRegister();
    expect(screen.getByTestId('auth-register-card')).toBeInTheDocument();
    expect(screen.getByTestId('auth-register-title')).toBeInTheDocument();
    expect(screen.getByTestId('auth-register-next')).toBeInTheDocument();
  });

  it('renders link to login page', () => {
    renderRegister();
    const link = screen.getByRole('link', { name: 'register.logIn' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/login');
  });

  it('preserves redirectTo in the login link when present', () => {
    renderRegister('/register?redirectTo=%2Fjoin%2Finvite-123');
    expect(screen.getByRole('link', { name: 'register.logIn' })).toHaveAttribute(
      'href',
      '/login?redirectTo=%2Fjoin%2Finvite-123',
    );
  });

  it('renders progress indicators', () => {
    const { container } = renderRegister();
    // 5-step wizard has 5 progress indicator bars
    const indicators = container.querySelectorAll('.rounded-full.h-2');
    expect(indicators).toHaveLength(5);
  });

  it('advances to the profile step when account info is valid', async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText('fields.email'), 'test@example.com');
    await user.type(screen.getByLabelText('fields.password'), 'Password123!');
    await user.type(screen.getByLabelText('fields.confirmPassword'), 'Password123!');
    await user.click(screen.getByTestId('auth-register-next'));

    expect(await screen.findByLabelText('fields.displayName')).toBeInTheDocument();
  });

  it('shows an age validation error for users younger than 13', async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText('fields.email'), 'test@example.com');
    await user.type(screen.getByLabelText('fields.password'), 'Password123!');
    await user.type(screen.getByLabelText('fields.confirmPassword'), 'Password123!');
    await user.click(screen.getByTestId('auth-register-next'));

    await user.type(await screen.findByLabelText('fields.displayName'), 'Test User');
    await user.click(screen.getByTestId('auth-register-next'));

    await user.selectOptions(screen.getByLabelText('fields.month'), '1');
    await user.selectOptions(screen.getByLabelText('fields.day'), '1');
    await user.selectOptions(screen.getByLabelText('fields.year'), String(new Date().getFullYear() - 10));
    await user.click(screen.getByTestId('auth-register-next'));

    expect(await screen.findByText('errors.mustBe13')).toBeInTheDocument();
  });

  it('submits successfully after completing all wizard steps', async () => {
    const user = userEvent.setup();
    mockRegisterUser.mockResolvedValue({
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

    renderRegister('/register?redirectTo=%2Fjoin%2Finvite-123');

    await user.type(screen.getByLabelText('fields.email'), 'test@example.com');
    await user.type(screen.getByLabelText('fields.password'), 'Password123!');
    await user.type(screen.getByLabelText('fields.confirmPassword'), 'Password123!');
    await user.click(screen.getByTestId('auth-register-next'));

    await user.type(await screen.findByLabelText('fields.displayName'), 'Test User');
    await user.click(screen.getByTestId('auth-register-next'));

    await user.selectOptions(screen.getByLabelText('fields.month'), '1');
    await user.selectOptions(screen.getByLabelText('fields.day'), '1');
    await user.selectOptions(screen.getByLabelText('fields.year'), String(new Date().getFullYear() - 20));
    await user.click(screen.getByTestId('auth-register-next'));

    await user.click(screen.getByLabelText(/terms\.agreeTerms/i));
    await user.click(screen.getByLabelText(/terms\.agreePrivacy/i));
    await user.click(screen.getByTestId('auth-register-next'));

    expect(await screen.findByTestId('auth-register-submit')).toBeInTheDocument();
    await user.click(screen.getByTestId('auth-register-submit'));

    await waitFor(() => {
      expect(mockRegisterUser).toHaveBeenCalledWith({
        client: {},
        body: {
          email: 'test@example.com',
          password: 'Password123!',
          displayName: 'Test User',
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
  }, 10_000);

  it('shows a server error when registration fails', async () => {
    const user = userEvent.setup();
    mockRegisterUser.mockRejectedValue({ message: 'Email already in use' });

    renderRegister();

    await user.type(screen.getByLabelText('fields.email'), 'test@example.com');
    await user.type(screen.getByLabelText('fields.password'), 'Password123!');
    await user.type(screen.getByLabelText('fields.confirmPassword'), 'Password123!');
    await user.click(screen.getByTestId('auth-register-next'));

    await user.type(await screen.findByLabelText('fields.displayName'), 'Test User');
    await user.click(screen.getByTestId('auth-register-next'));

    await user.selectOptions(screen.getByLabelText('fields.month'), '1');
    await user.selectOptions(screen.getByLabelText('fields.day'), '1');
    await user.selectOptions(screen.getByLabelText('fields.year'), String(new Date().getFullYear() - 20));
    await user.click(screen.getByTestId('auth-register-next'));

    await user.click(screen.getByLabelText(/terms\.agreeTerms/i));
    await user.click(screen.getByLabelText(/terms\.agreePrivacy/i));
    await user.click(screen.getByTestId('auth-register-next'));
    await user.click(await screen.findByTestId('auth-register-submit'));

    expect(await screen.findByText('Email already in use')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  }, 10_000);
});
