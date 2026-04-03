import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountDeletionCard } from './account-deletion-card';

const cancelAccountDeletion = vi.fn();
const post = vi.fn();

vi.mock('./hooks/use-profile', () => ({
  useProfile: () => ({
    data: { displayName: 'Test User' },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  client: { post: (...args: unknown[]) => post(...args) },
  cancelAccountDeletion: (...args: unknown[]) => cancelAccountDeletion(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountDeletionCard />
    </QueryClientProvider>,
  );
}

describe('AccountDeletionCard', () => {
  beforeEach(() => {
    post.mockResolvedValue({ data: { requestId: 'del-1', message: 'ok' }, error: null });
    cancelAccountDeletion.mockResolvedValue({ data: { success: true }, error: null });
  });

  it('requests account deletion through the backend contract', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByPlaceholderText('Test User'), 'Test User');
    await user.click(screen.getByRole('button', { name: /permanently delete/i }));

    await waitFor(() => {
      expect(post).toHaveBeenCalled();
    });
    expect(screen.getByText(/account scheduled for deletion/i)).toBeInTheDocument();
  });

  it('allows the pending deletion request to be cancelled', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByPlaceholderText('Test User'), 'Test User');
    await user.click(screen.getByRole('button', { name: /permanently delete/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /cancel deletion/i }));

    await waitFor(() => {
      expect(cancelAccountDeletion).toHaveBeenCalled();
    });
  });
});
