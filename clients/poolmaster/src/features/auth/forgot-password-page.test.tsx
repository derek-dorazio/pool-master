import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ForgotPasswordPage } from './forgot-password-page';

const { requestPasswordResetMock } = vi.hoisted(() => ({
  requestPasswordResetMock: vi.fn(),
}));

bindApiMocks({
  requestPasswordReset: requestPasswordResetMock,
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/forgot-password']}>
        <Routes>
          <Route element={<ForgotPasswordPage />} path="/forgot-password" />
          <Route element={<div>Sign in page</div>} path="/" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    requestPasswordResetMock.mockReset();
  });

  it('sends the typed email or username and shows the same check-your-email confirmation', async () => {
    requestPasswordResetMock.mockResolvedValue({ data: { success: true }, status: 202 });
    renderPage();

    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: 'riley@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/If an account matches, we've sent a link to reset your password/)).toBeInTheDocument();
    expect(requestPasswordResetMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: { identifier: 'riley@example.com' } }),
    );
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/');
  });

  it('asks for an email or username before it sends anything', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText('Enter your email or username')).toBeInTheDocument();
    expect(requestPasswordResetMock).not.toHaveBeenCalled();
  });

  it('tells the person to wait a minute when the address is over its limit', async () => {
    requestPasswordResetMock.mockResolvedValue({
      error: { error: { code: 'PASSWORD_RESET_RATE_LIMITED', message: 'Rate limited' } },
      status: 429,
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: 'riley' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText('Too many tries. Wait a minute and try again.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your email' })).not.toBeInTheDocument();
  });
});
