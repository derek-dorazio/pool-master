import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ResetPasswordPage } from './reset-password-page';

const { authState, confirmPasswordResetMock } = vi.hoisted(() => ({
  authState: {
    user: null as { id: string } | null,
    isAuthenticated: false,
    isLoading: false,
    isRootAdmin: false,
    clearSession: vi.fn(),
  },
  confirmPasswordResetMock: vi.fn(),
}));

bindApiMocks({
  confirmPasswordReset: confirmPasswordResetMock,
});

vi.mock('./auth-context', () => ({
  useAuth: () => authState,
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current address">{`${location.pathname}${location.hash}`}</output>;
}

function renderPage(entry = '/reset-password#token=link-token-123') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            element={
              <>
                <ResetPasswordPage />
                <LocationProbe />
              </>
            }
            path="/reset-password"
          />
          <Route element={<div>Forgot password page</div>} path="/forgot-password" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fillAndSubmit(newPassword: string, confirmNewPassword: string) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: newPassword } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmNewPassword } });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    confirmPasswordResetMock.mockReset();
    authState.user = null;
    authState.clearSession.mockReset();
  });

  it('sends the token from the link with the new password and then asks the person to sign in', async () => {
    confirmPasswordResetMock.mockResolvedValue({ data: { success: true } });
    renderPage();

    fillAndSubmit('Recovered-Pass2', 'Recovered-Pass2');

    expect(await screen.findByText('Your password is reset. Sign in with your new password.')).toBeInTheDocument();
    expect(confirmPasswordResetMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { token: 'link-token-123', newPassword: 'Recovered-Pass2', confirmNewPassword: 'Recovered-Pass2' },
    }));
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/');
  });

  it('clears the token from the address bar as soon as the page has read it', async () => {
    renderPage();

    expect(await screen.findByLabelText('Current address')).toHaveTextContent(/^\/reset-password$/);
    expect(screen.getByRole('button', { name: 'Set new password' })).toBeInTheDocument();
  });

  it('ends this browser\'s session too when a signed-in person resets their password', async () => {
    authState.user = { id: 'user-1' };
    confirmPasswordResetMock.mockResolvedValue({ data: { success: true } });
    renderPage();

    fillAndSubmit('Recovered-Pass2', 'Recovered-Pass2');

    expect(await screen.findByText('Your password is reset. Sign in with your new password.')).toBeInTheDocument();
    expect(authState.clearSession).toHaveBeenCalledTimes(1);
  });

  it('shows the dead-link state with a way to send a new link when the link is used or expired', async () => {
    confirmPasswordResetMock.mockResolvedValue({
      error: { error: { code: 'PASSWORD_RESET_LINK_INVALID', message: 'Dead link' } },
    });
    renderPage();

    fillAndSubmit('Recovered-Pass2', 'Recovered-Pass2');

    expect(await screen.findByText('This reset link has expired or has already been used.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send a new link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('shows the dead-link state straight away when the link carries no token', () => {
    renderPage('/reset-password');

    expect(screen.getByText('This reset link has expired or has already been used.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set new password' })).not.toBeInTheDocument();
  });

  it('refuses passwords that do not match before it calls the server', async () => {
    renderPage();

    fillAndSubmit('Recovered-Pass2', 'Different-Pass3');

    expect(await screen.findByText('Passwords must match')).toBeInTheDocument();
    expect(confirmPasswordResetMock).not.toHaveBeenCalled();
  });

  it('refuses a new password shorter than 8 characters before it calls the server', async () => {
    renderPage();

    fillAndSubmit('short', 'short');

    expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument();
    expect(confirmPasswordResetMock).not.toHaveBeenCalled();
  });
});
