import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { EmailPreferencesResponse } from '@poolmaster/shared/dto';
import { OptionalEmailCategory } from '@poolmaster/shared/domain';
import type { AuthSessionUser } from '@/features/auth/auth-session-cache';
import { AuthProvider } from '@/features/auth/auth-provider';
import { MyAccountPage } from '@/features/account/my-account/my-account-page';
import { UserPageRedirect } from '@/features/account/user-page-redirect';
import { Toaster } from '@/features/shared/ui';
import { mockApi } from './msw-api';

/** The My account tests' shared setup: the signed-in member, their reads, and the page in its routes. */

export function buildCurrentUser(overrides: Partial<AuthSessionUser> = {}): AuthSessionUser {
  return {
    id: 'user-1',
    email: 'derek@example.com',
    username: 'ddorazio',
    firstName: 'Derek',
    lastName: 'Dorazio',
    isActive: true,
    isRootAdmin: false,
    timezone: 'America/New_York',
    locale: 'en-US',
    timeFormat: '12H',
    createdAt: '2026-04-13T12:00:00.000Z',
    ...overrides,
  };
}

export function buildEmailPreferences(overrides: Partial<EmailPreferencesResponse> = {}): EmailPreferencesResponse {
  return {
    preferences: Object.values(OptionalEmailCategory).map((category) => ({ category, enabled: true })),
    emailSuppression: null,
    ...overrides,
  };
}

/** Primes the signed-in member's own reads: who they are, their payments and their email switches. */
export function primeMyAccount(overrides: Partial<AuthSessionUser> = {}) {
  const user = buildCurrentUser(overrides);
  mockApi.getUser.mockResolvedValue({ data: { user } });
  mockApi.refreshToken.mockResolvedValue({ data: null });
  mockApi.listUserPayments.mockResolvedValue({ data: { payments: [] } });
  mockApi.getUserEmailPreferences.mockResolvedValue({ data: buildEmailPreferences() });
  return user;
}

/**
 * As `primeMyAccount`, but once the page has saved a change to the account, every read answers
 * with `updated`. Keyed on the save rather than on a count of reads, so a read still in flight
 * from an earlier test cannot use up the first answer.
 */
export function primeMyAccountThenRefetches(updated: AuthSessionUser, overrides: Partial<AuthSessionUser> = {}) {
  const user = primeMyAccount(overrides);
  const saves = [mockApi.updateUserProfile, mockApi.updateUserUsername, mockApi.updateUserPreferences, mockApi.disableUser, mockApi.enableUser];
  mockApi.getUser.mockImplementation(() =>
    Promise.resolve({ data: { user: saves.some((save) => save.mock.calls.length > 0) ? updated : user } }));
  return user;
}

export function renderMyAccount(initialEntry = '/my-account') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route element={<MyAccountPage />} path="/my-account" />
            <Route element={<UserPageRedirect />} path="/users/:userId" />
            <Route element={<div data-testid="root-route" />} path="/" />
            <Route element={<div data-testid="manage-user-route" />} path="/manage/users/user-2" />
          </Routes>
          <Toaster />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}
