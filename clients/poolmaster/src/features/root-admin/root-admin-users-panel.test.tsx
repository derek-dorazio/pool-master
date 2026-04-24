import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootAdminUsersPanel } from './root-admin-users-panel';

const {
  adminListUsersMock,
  adminSetUserRootAdminMock,
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
    adminListUsersMock: vi.fn(),
    adminSetUserRootAdminMock: vi.fn(),
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  adminListUsers: (...args: unknown[]) => adminListUsersMock(...args),
  adminSetUserRootAdmin: (...args: unknown[]) => adminSetUserRootAdminMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    user: {
      id: 'root-admin-user',
      firstName: 'Root',
      lastName: 'Admin',
      isRootAdmin: true,
    },
  }),
}));

function renderUsersPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminUsersPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function seedUserList() {
  adminListUsersMock.mockResolvedValue({
    data: {
      items: [
        {
          id: 'root-admin-user',
          email: 'root-admin@example.com',
          username: 'rootadmin',
          firstName: 'Root',
          lastName: 'Admin',
          isRootAdmin: true,
          isActive: true,
          createdAt: '2026-04-10T12:00:00.000Z',
        },
        {
          id: 'target-user',
          email: 'target@example.com',
          username: 'targetuser',
          firstName: 'Target',
          lastName: 'User',
          isRootAdmin: false,
          isActive: true,
          createdAt: '2026-04-11T12:00:00.000Z',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    },
  });
  adminSetUserRootAdminMock.mockResolvedValue({
    data: {
      success: true,
    },
  });
}

describe('RootAdminUsersPanel', () => {
  beforeEach(() => {
    seedUserList();
  });

  afterEach(() => {
    adminListUsersMock.mockReset();
    adminSetUserRootAdminMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
  });

  it('renders the user list', async () => {
    renderUsersPanel();

    expect(await screen.findByTestId('root-admin-users-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-user-row-target-user')).toBeInTheDocument();
    expect(screen.getByText('Target User')).toBeInTheDocument();
    expect(screen.getByText('@targetuser')).toBeInTheDocument();
  });

  it('searches users by the submitted search text', async () => {
    renderUsersPanel();

    const searchInput = await screen.findByTestId('root-admin-users-search');
    fireEvent.change(searchInput, {
      target: { value: 'targetuser' },
    });

    await waitFor(() =>
      expect(adminListUsersMock).toHaveBeenLastCalledWith({
        query: {
          search: 'targetuser',
          page: 1,
          pageSize: 25,
        },
      }),
    );
  });

  it('submits a promote action with the optional reason', async () => {
    renderUsersPanel();

    fireEvent.click(await screen.findByTestId('root-admin-user-promote-target-user'));
    fireEvent.change(screen.getByTestId('root-admin-user-reason'), {
      target: { value: 'Need second operator' },
    });
    fireEvent.click(screen.getByTestId('root-admin-user-confirm'));

    await waitFor(() =>
      expect(adminSetUserRootAdminMock).toHaveBeenCalledWith({
        path: {
          userId: 'target-user',
        },
        body: {
          isRootAdmin: true,
          reason: 'Need second operator',
        },
      }),
    );
  });

  it('submits a demote action for another root admin', async () => {
    adminListUsersMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'root-admin-user',
            email: 'root-admin@example.com',
            username: 'rootadmin',
            firstName: 'Root',
            lastName: 'Admin',
            isRootAdmin: true,
            isActive: true,
            createdAt: '2026-04-10T12:00:00.000Z',
          },
          {
            id: 'other-root-admin',
            email: 'other-root-admin@example.com',
            username: 'otherroot',
            firstName: 'Other',
            lastName: 'Admin',
            isRootAdmin: true,
            isActive: true,
            createdAt: '2026-04-11T12:00:00.000Z',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      },
    });

    renderUsersPanel();

    fireEvent.click(await screen.findByTestId('root-admin-user-demote-other-root-admin'));
    fireEvent.click(screen.getByTestId('root-admin-user-confirm'));

    await waitFor(() =>
      expect(adminSetUserRootAdminMock).toHaveBeenCalledWith({
        path: {
          userId: 'other-root-admin',
        },
        body: {
          isRootAdmin: false,
          reason: undefined,
        },
      }),
    );
  });

  it('disables self-demotion in the table', async () => {
    renderUsersPanel();

    expect(await screen.findByTestId('root-admin-user-demote-root-admin-user')).toBeDisabled();
  });

  it('surfaces backend role-change errors inline', async () => {
    adminSetUserRootAdminMock.mockResolvedValue({
      error: {
        error: {
          code: 'LAST_ROOT_ADMIN',
          message: 'Cannot perform action, this user is the only remaining root admin',
        },
      },
    });

    renderUsersPanel();

    fireEvent.click(await screen.findByTestId('root-admin-user-promote-target-user'));
    fireEvent.click(screen.getByTestId('root-admin-user-confirm'));

    expect(await screen.findByTestId('root-admin-user-error')).toHaveTextContent(
      'LAST_ROOT_ADMIN: Cannot perform action, this user is the only remaining root admin',
    );
  });
});
