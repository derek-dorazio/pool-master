import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
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

bindApiMocks({
  listUsers: adminListUsersMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
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

/** Types into the page's search box; the page asks the server once the debounce settles. */
function searchFor(term: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find a user' }), {
    target: { value: term },
  });
}

describe('RootAdminManageUsersPage', () => {
  beforeEach(() => {
    adminListUsersMock.mockResolvedValue({
      data: {
        users: [
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

  it('asks for at least 3 characters and reads no users until they are typed', async () => {
    renderManageUsersPage();

    expect(await screen.findByText('Type at least 3 characters to find a user.')).toBeInTheDocument();
    searchFor('al');
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(screen.getByText('Type at least 3 characters to find a user.')).toBeInTheDocument();
    expect(adminListUsersMock).not.toHaveBeenCalled();
  });

  it('sends the typed search to the server once and shows the users it returns', async () => {
    renderManageUsersPage();

    searchFor('example');

    expect(await screen.findByTestId('root-admin-manage-user-row-user-1')).toBeInTheDocument();
    expect(adminListUsersMock).toHaveBeenCalledTimes(1);
    expect(adminListUsersMock).toHaveBeenLastCalledWith({ query: { search: 'example' } });
  });

  it('keeps the search box and shows the error in the grid when the search fails', async () => {
    adminListUsersMock.mockResolvedValue({
      data: null,
      error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } },
    });
    renderManageUsersPage();

    searchFor('example');

    expect(await screen.findByText('Boom')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Find a user' })).toHaveValue('example');
  });

  it('pool-master-dxd.35 renders the user grid without duplicate directory helper copy', async () => {
    renderManageUsersPage();

    expect(await screen.findByTestId('root-admin-manage-users-page')).toBeInTheDocument();
    searchFor('example');
    expect(screen.queryByText('User directory')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Filter by the columns below and open a user page from the name column.'),
    ).not.toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-manage-user-row-user-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alex Admin/ })).toHaveAttribute(
      'href',
      '/manage/users/user-1',
    );
    expect(screen.queryByRole('link', { name: 'Open user page' })).not.toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('pool-master-5fr filters users client-side through grid column filters', async () => {
    renderManageUsersPage();

    searchFor('example');
    await screen.findByTestId('root-admin-manage-user-row-user-1');
    // §16 — the MSW harness rebuilds `options` from the real request: the search and nothing
    // else was sent, so no page and no pageSize.
    expect(adminListUsersMock).toHaveBeenLastCalledWith({ query: { search: 'example' } });

    fireEvent.change(screen.getByTestId('data-grid-filter-username'), {
      target: {
        value: 'jamie',
      },
    });

    expect(screen.queryByTestId('root-admin-manage-user-row-user-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-manage-user-row-user-2')).toBeInTheDocument();
    expect(adminListUsersMock).toHaveBeenCalledTimes(1);
  });

  it('narrows the returned users to matching names or emails as the search grows', async () => {
    renderManageUsersPage();

    searchFor('example');
    await screen.findByTestId('root-admin-manage-user-row-user-1');
    searchFor('jamie@');

    expect(screen.queryByTestId('root-admin-manage-user-row-user-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-manage-user-row-user-2')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-manage-user-row-user-2')).toBeInTheDocument();
  });

  it('shows 25 users a page and pages on to the rest', async () => {
    adminListUsersMock.mockResolvedValue({
      data: {
        users: Array.from({ length: 30 }, (_, index) => ({
          id: `user-${String(index + 1)}`,
          email: `user${String(index + 1)}@example.com`,
          username: `user${String(index + 1)}`,
          firstName: 'Pool',
          lastName: `Player ${String(index + 1).padStart(2, '0')}`,
          isRootAdmin: false,
          isActive: true,
          createdAt: '2026-04-11T12:00:00.000Z',
        })),
      },
    });

    renderManageUsersPage();

    searchFor('example');
    await screen.findByTestId('root-admin-manage-user-row-user-1');
    expect(screen.queryByTestId('root-admin-manage-user-row-user-26')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(await screen.findByTestId('root-admin-manage-user-row-user-26')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-manage-user-row-user-1')).not.toBeInTheDocument();
  });
});
