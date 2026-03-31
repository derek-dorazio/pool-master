import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Component as UsersPage } from './index';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockUsers = [
  { id: 'u-1', email: 'john@acme.com', displayName: 'John Doe', tenants: ['Acme Corp'], lastLogin: new Date().toISOString(), status: 'Active' },
  { id: 'u-2', email: 'jane@beta.com', displayName: 'Jane Smith', tenants: ['Beta League', 'FanDraft'], lastLogin: new Date().toISOString(), status: 'Disabled' },
];

let mockQuery = '';

vi.mock('@/hooks/use-admin-api', () => ({
  useUserSearch: (query: string) => {
    mockQuery = query;
    if (!query) return { data: undefined, isLoading: false, isFetched: false };
    return { data: mockUsers, isLoading: false, isFetched: true };
  },
}));

function renderUsers() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );
}

describe('UsersPage', () => {
  it('renders search input', () => {
    renderUsers();

    expect(screen.getByPlaceholderText(/search by email/i)).toBeInTheDocument();
  });

  it('shows empty state before search', () => {
    renderUsers();

    expect(screen.getByText(/enter a search term/i)).toBeInTheDocument();
  });

  it('shows results table after typing a search query', async () => {
    const user = userEvent.setup();
    renderUsers();

    const input = screen.getByPlaceholderText(/search by email/i);
    await user.type(input, 'john');

    expect(screen.getByText('john@acme.com')).toBeInTheDocument();
    expect(screen.getByText('jane@beta.com')).toBeInTheDocument();
  });

  it('user rows have email and display name', async () => {
    const user = userEvent.setup();
    renderUsers();

    await user.type(screen.getByPlaceholderText(/search by email/i), 'john');

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@acme.com')).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('jane@beta.com')).toBeInTheDocument();
  });

  it('renders page heading', () => {
    renderUsers();

    expect(screen.getByRole('heading', { name: 'User Search' })).toBeInTheDocument();
  });
});
