import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { UserPage } from './user-page';

const {
  changeAccountPasswordMock,
  inactivateAccountMock,
  deleteAccountMock,
  getCurrentUserMock,
  logoutUserMock,
  reactivateAccountMock,
  refreshTokenMock,
  updateAccountPreferencesMock,
  updateAccountProfileMock,
  mockLogger,
} = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);

  return {
    changeAccountPasswordMock: vi.fn(),
    inactivateAccountMock: vi.fn(),
    deleteAccountMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    logoutUserMock: vi.fn(),
    reactivateAccountMock: vi.fn(),
    refreshTokenMock: vi.fn(),
    updateAccountPreferencesMock: vi.fn(),
    updateAccountProfileMock: vi.fn(),
    mockLogger,
  };
});

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

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

function renderUserPage(initialEntry = '/users/user-1') {
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
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route element={<UserPage />} path="/users/:userId" />
            <Route element={<div data-testid="root-route" />} path="/" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeCurrentUser({
  id = 'user-1',
  isActive = true,
  isRootAdmin = false,
}: {
  id?: string;
  isActive?: boolean;
  isRootAdmin?: boolean;
} = {}) {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id,
        email: 'derek@example.com',
        username: 'ddorazio',
        firstName: 'Derek',
        lastName: 'Dorazio',
        isActive,
        isRootAdmin,
        timezone: 'America/New_York',
        locale: 'en-US',
        timeFormat: '12H',
        dateFormat: 'MDY',
        createdAt: '2026-04-13T00:00:00.000Z',
      },
    },
  });
  refreshTokenMock.mockResolvedValue({ data: null });
}

describe('UserPage', () => {
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
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
    useSessionStore.getState().clearSession();
  });

  it('updates the self profile from the canonical user page dialog', async () => {
    primeCurrentUser();
    updateAccountProfileMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          username: 'ddorazio',
          firstName: 'Updated',
          lastName: 'Person',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-profile'));
    await screen.findByTestId('user-page-profile-dialog');

    fireEvent.change(screen.getByTestId('user-page-first-name'), {
      target: { value: 'Updated' },
    });
    fireEvent.change(screen.getByTestId('user-page-last-name'), {
      target: { value: 'Person' },
    });
    fireEvent.click(screen.getByTestId('user-page-save-profile'));

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

  it('keeps delete locked until the account is inactive', async () => {
    primeCurrentUser({ isActive: true });

    renderUserPage();

    await screen.findByTestId('user-page');
    expect(screen.getByTestId('user-page-open-delete')).toBeDisabled();
  });

  it('reactivates an inactive account from the lifecycle dialog', async () => {
    primeCurrentUser({ isActive: false });
    reactivateAccountMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          username: 'ddorazio',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    renderUserPage();

    await screen.findByTestId('user-page-inactive-banner');
    fireEvent.click(screen.getByTestId('user-page-open-lifecycle'));
    await screen.findByTestId('user-page-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('user-page-reactivate'));

    await waitFor(() => expect(reactivateAccountMock).toHaveBeenCalledTimes(1));
  });

  it('shows a truthful placeholder for non-self user routes', async () => {
    primeCurrentUser({ id: 'user-1' });

    renderUserPage('/users/user-2');

    expect(await screen.findByTestId('user-page-non-self-placeholder')).toBeVisible();
    expect(screen.getByTestId('user-page-self-link')).toHaveAttribute('href', '/users/user-1');
  });
});
