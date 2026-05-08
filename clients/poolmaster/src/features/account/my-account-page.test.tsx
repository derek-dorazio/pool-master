import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { MyAccountPage } from './my-account-page';

const {
  getCurrentUserMock,
  logoutUserMock,
  refreshTokenMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  logoutUserMock: vi.fn(),
  refreshTokenMock: vi.fn(),
}));

bindApiMocks({
  getCurrentUser: getCurrentUserMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
});

function renderLegacyMyAccountRoute() {
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
        <MemoryRouter initialEntries={['/my-account']}>
          <Routes>
            <Route element={<MyAccountPage />} path="/my-account" />
            <Route element={<div data-testid="canonical-user-route" />} path="/users/:userId" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('MyAccountPage', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('redirects the legacy /my-account route to the canonical self user page', async () => {
    getCurrentUserMock.mockResolvedValue({
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
    refreshTokenMock.mockResolvedValue({ data: null });

    renderLegacyMyAccountRoute();

    expect(await screen.findByTestId('canonical-user-route')).toBeVisible();
  });
});
