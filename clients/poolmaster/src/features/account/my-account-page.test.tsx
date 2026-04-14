import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { MyAccountPage } from './my-account-page';

const inactivateAccountMock = vi.fn();
const deleteAccountMock = vi.fn();
const getCurrentUserMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();

vi.mock('@/lib/api', () => ({
  inactivateAccount: (...args: unknown[]) => inactivateAccountMock(...args),
  deleteAccount: (...args: unknown[]) => deleteAccountMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
}));

function renderMyAccountPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter>
          <MyAccountPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('MyAccountPage', () => {
  afterEach(() => {
    inactivateAccountMock.mockReset();
    deleteAccountMock.mockReset();
    getCurrentUserMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('inactivates the current account and unlocks delete', async () => {
    getCurrentUserMock
      .mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-1',
            email: 'derek@example.com',
            displayName: 'Derek Dorazio',
            isActive: true,
            isRootAdmin: false,
          },
        },
      })
      .mockResolvedValue({
        data: {
          user: {
            id: 'user-1',
            email: 'derek@example.com',
            displayName: 'Derek Dorazio',
            isActive: false,
            isRootAdmin: false,
          },
        },
      });
    refreshTokenMock.mockResolvedValue({ data: null });
    inactivateAccountMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          displayName: 'Derek Dorazio',
          isActive: false,
          isRootAdmin: false,
        },
      },
    });

    renderMyAccountPage();

    await screen.findByTestId('my-account-page');
    fireEvent.click(screen.getByTestId('my-account-inactivate'));

    await waitFor(() => expect(inactivateAccountMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Account inactive')).toBeVisible());

    expect(screen.getByTestId('my-account-delete-trigger')).not.toBeDisabled();
  });

  it('keeps delete disabled until the email confirmation matches exactly', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          displayName: 'Derek Dorazio',
          isActive: false,
          isRootAdmin: false,
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });

    renderMyAccountPage();

    await screen.findByTestId('my-account-page');
    fireEvent.click(screen.getByTestId('my-account-delete-trigger'));

    const deleteButton = screen.getByTestId('my-account-delete-submit');
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByTestId('my-account-delete-confirmation'), {
      target: { value: 'wrong@example.com' },
    });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByTestId('my-account-delete-confirmation'), {
      target: { value: 'derek@example.com' },
    });

    await waitFor(() => expect(deleteButton).not.toBeDisabled());
  });

  it('deletes the inactive account and shows the signed-out success path', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          displayName: 'Derek Dorazio',
          isActive: false,
          isRootAdmin: false,
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    deleteAccountMock.mockResolvedValue({
      data: {
        success: true,
      },
    });
    logoutUserMock.mockResolvedValue({
      data: {
        success: true,
      },
    });

    renderMyAccountPage();

    await screen.findByTestId('my-account-page');
    fireEvent.click(screen.getByTestId('my-account-delete-trigger'));
    fireEvent.change(screen.getByTestId('my-account-delete-confirmation'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.click(screen.getByTestId('my-account-delete-submit'));

    await waitFor(() =>
      expect(deleteAccountMock).toHaveBeenCalledWith({
        body: {
          email: 'derek@example.com',
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('my-account-delete-success')).toBeVisible(),
    );
  });
});
