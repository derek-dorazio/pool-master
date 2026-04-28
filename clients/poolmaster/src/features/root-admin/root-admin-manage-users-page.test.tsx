import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootAdminManageUsersPage } from './root-admin-manage-users-page';

const {
  adminListUsersMock,
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
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  adminListUsers: (...args: unknown[]) => adminListUsersMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

function renderManageUsersPage() {
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
        <RootAdminManageUsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminManageUsersPage', () => {
  beforeEach(() => {
    adminListUsersMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'user-1',
            email: 'alex@example.com',
            username: 'alex',
            firstName: 'Alex',
            lastName: 'Admin',
            isRootAdmin: true,
            isActive: true,
            createdAt: '2026-04-11T12:00:00.000Z',
          },
          {
            id: 'user-2',
            email: 'jamie@example.com',
            username: 'jamie',
            firstName: 'Jamie',
            lastName: 'Member',
            isRootAdmin: false,
            isActive: false,
            createdAt: '2026-04-12T12:00:00.000Z',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      },
    });
  });

  afterEach(() => {
    adminListUsersMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
  });

  it('renders the dedicated user directory with canonical user-page links', async () => {
    renderManageUsersPage();

    expect(await screen.findByTestId('root-admin-manage-users-page')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-manage-user-row-user-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alex Admin' })).toHaveAttribute(
      'href',
      '/users/user-1',
    );
    expect(screen.queryByRole('link', { name: 'Open user page' })).not.toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('passes search input through the admin list query', async () => {
    renderManageUsersPage();

    const searchInput = await screen.findByTestId('root-admin-manage-users-search');
    fireEvent.change(searchInput, {
      target: {
        value: 'jamie',
      },
    });

    await waitFor(() =>
      expect(adminListUsersMock).toHaveBeenLastCalledWith({
        query: {
          search: 'jamie',
          page: 1,
          pageSize: 25,
        },
      }),
    );
  });
});
