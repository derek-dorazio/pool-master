import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { MyAccountPage } from './my-account-page';

const changeAccountPasswordMock = vi.fn();
const inactivateAccountMock = vi.fn();
const deleteAccountMock = vi.fn();
const getCurrentUserMock = vi.fn();
const logoutUserMock = vi.fn();
const reactivateAccountMock = vi.fn();
const refreshTokenMock = vi.fn();
const updateAccountPreferencesMock = vi.fn();
const updateAccountProfileMock = vi.fn();

vi.mock('@/lib/api', () => ({
  changeAccountPassword: (...args: unknown[]) => changeAccountPasswordMock(...args),
  inactivateAccount: (...args: unknown[]) => inactivateAccountMock(...args),
  deleteAccount: (...args: unknown[]) => deleteAccountMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  reactivateAccount: (...args: unknown[]) => reactivateAccountMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  updateAccountPreferences: (...args: unknown[]) => updateAccountPreferencesMock(...args),
  updateAccountProfile: (...args: unknown[]) => updateAccountProfileMock(...args),
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
    changeAccountPasswordMock.mockReset();
    inactivateAccountMock.mockReset();
    deleteAccountMock.mockReset();
    getCurrentUserMock.mockReset();
    logoutUserMock.mockReset();
    reactivateAccountMock.mockReset();
    refreshTokenMock.mockReset();
    updateAccountPreferencesMock.mockReset();
    updateAccountProfileMock.mockReset();
    useSessionStore.getState().clearSession();
  });

  it('updates the active account profile', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    updateAccountProfileMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Updated',
          lastName: 'Person',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    renderMyAccountPage();

    await screen.findByTestId('my-account-page');
    fireEvent.change(screen.getByTestId('my-account-first-name'), {
      target: { value: 'Updated' },
    });
    fireEvent.change(screen.getByTestId('my-account-last-name'), {
      target: { value: 'Person' },
    });
    fireEvent.click(screen.getByTestId('my-account-save-profile'));

    await waitFor(() =>
      expect(updateAccountProfileMock).toHaveBeenCalledWith({
        body: {
          firstName: 'Updated',
          lastName: 'Person',
        },
      }),
    );
    await waitFor(() => expect(screen.getByText('Your profile was updated.')).toBeVisible());
  });

  it('inactivates the current account and unlocks delete', async () => {
    getCurrentUserMock
      .mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            isActive: true,
            isRootAdmin: false,
            createdAt: '2026-04-13T00:00:00.000Z',
          },
        },
      })
      .mockResolvedValue({
        data: {
          user: {
            id: 'user-1',
            email: 'derek@example.com',
            firstName: 'Derek',
            lastName: 'Dorazio',
            isActive: false,
            isRootAdmin: false,
            createdAt: '2026-04-13T00:00:00.000Z',
          },
        },
      });
    refreshTokenMock.mockResolvedValue({ data: null });
    inactivateAccountMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: false,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    renderMyAccountPage();

    await screen.findByTestId('my-account-page');
    fireEvent.click(screen.getByTestId('my-account-inactivate'));

    await waitFor(() => expect(inactivateAccountMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Inactive')).toBeVisible());

    expect(screen.getByTestId('my-account-delete-trigger')).not.toBeDisabled();
  });

  it('keeps delete disabled until the email confirmation matches exactly', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: false,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
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

  it('shows inactive accounts as read-only and allows reactivation', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: false,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });
    refreshTokenMock.mockResolvedValue({ data: null });
    reactivateAccountMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    renderMyAccountPage();

    await screen.findByTestId('my-account-page');
    expect(screen.getByTestId('my-account-first-name')).toBeDisabled();
    expect(screen.getByTestId('my-account-save-profile')).toBeDisabled();

    fireEvent.click(screen.getByTestId('my-account-reactivate'));

    await waitFor(() => expect(reactivateAccountMock).toHaveBeenCalledTimes(1));
  });

  it('deletes the inactive account and shows the signed-out success path', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: false,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
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
