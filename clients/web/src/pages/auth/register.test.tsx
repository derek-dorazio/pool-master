import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Component as RegisterPage } from './register';

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

function renderRegister() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

describe('RegisterPage', () => {
  it('renders step 1 with email and password fields', () => {
    renderRegister();
    expect(screen.getByLabelText('fields.email')).toBeInTheDocument();
    expect(screen.getByLabelText('fields.password')).toBeInTheDocument();
    expect(screen.getByLabelText('fields.confirmPassword')).toBeInTheDocument();
  });

  it('renders "Next" button', () => {
    renderRegister();
    expect(screen.getByRole('button', { name: 'common:buttons.next' })).toBeInTheDocument();
  });

  it('renders link to login page', () => {
    renderRegister();
    const link = screen.getByRole('link', { name: 'register.logIn' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/login');
  });

  it('renders progress indicators', () => {
    const { container } = renderRegister();
    // 5-step wizard has 5 progress indicator bars
    const indicators = container.querySelectorAll('.rounded-full.h-2');
    expect(indicators).toHaveLength(5);
  });
});
