import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountDeletionCard } from './account-deletion-card';

const requestAccountDeletion = vi.fn();
const cancelAccountDeletion = vi.fn();
const getAccountDeletionStatus = vi.fn();

vi.mock('./hooks/use-profile', () => ({
  useProfile: () => ({
    data: { displayName: 'Test User' },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  client: {},
  requestAccountDeletion: (...args: unknown[]) => requestAccountDeletion(...args),
  cancelAccountDeletion: (...args: unknown[]) => cancelAccountDeletion(...args),
  getAccountDeletionStatus: (...args: unknown[]) => getAccountDeletionStatus(...args),
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
    getAccountDeletionStatus.mockResolvedValue({
      data: {
        status: 'none',
        requestId: null,
        requestedAt: null,
        scheduledDeletionAt: null,
        cancelledAt: null,
        completedAt: null,
        reason: null,
      },
      error: null,
    });
    requestAccountDeletion.mockResolvedValue({ data: { requestId: 'del-1', message: 'ok' }, error: null });
    cancelAccountDeletion.mockResolvedValue({ data: { success: true }, error: null });
  });

  it('requests account deletion through the backend contract', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByPlaceholderText('Test User'), 'Test User');
    await user.click(screen.getByRole('button', { name: /permanently delete/i }));

    await waitFor(() => {
      expect(requestAccountDeletion).toHaveBeenCalledWith(expect.objectContaining({
        body: { reason: 'user_requested' },
      }));
    });
    expect(await screen.findByText(/account scheduled for deletion/i)).toBeInTheDocument();
  });

  it('allows the pending deletion request to be cancelled', async () => {
    const user = userEvent.setup();
    getAccountDeletionStatus
      .mockResolvedValueOnce({
        data: {
          status: 'none',
          requestId: null,
          requestedAt: null,
          scheduledDeletionAt: null,
          cancelledAt: null,
          completedAt: null,
          reason: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          status: 'pending',
          requestId: 'del-1',
          requestedAt: '2026-04-03T12:00:00.000Z',
          scheduledDeletionAt: '2026-04-17T12:00:00.000Z',
          cancelledAt: null,
          completedAt: null,
          reason: 'user_requested',
        },
        error: null,
      });
    renderCard();

    await user.click(await screen.findByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.type(screen.getByPlaceholderText('Test User'), 'Test User');
    await user.click(screen.getByRole('button', { name: /permanently delete/i }));
    await waitFor(() => expect(requestAccountDeletion).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /cancel deletion/i }));

    await waitFor(() => {
      expect(cancelAccountDeletion).toHaveBeenCalled();
    });
  });

  it('shows an existing pending deletion request from persisted backend status', async () => {
    getAccountDeletionStatus.mockResolvedValue({
      data: {
        status: 'pending',
        requestId: 'del-1',
        requestedAt: '2026-04-03T12:00:00.000Z',
        scheduledDeletionAt: '2026-04-17T12:00:00.000Z',
        cancelledAt: null,
        completedAt: null,
        reason: 'user_requested',
      },
      error: null,
    });

    renderCard();

    expect(await screen.findByText(/account scheduled for deletion/i)).toBeInTheDocument();
    expect(screen.getByText(/scheduled deletion date/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel deletion/i })).toBeInTheDocument();
  });

  it('shows an error state when status fetch fails and offers retry', async () => {
    getAccountDeletionStatus.mockRejectedValue(new Error('Network error'));

    renderCard();

    expect(await screen.findByText(/couldn't load your account deletion status/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete my account/i })).not.toBeInTheDocument();
  });

  it('keeps the delete button disabled until display name matches', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const confirmButton = screen.getByRole('button', { name: /permanently delete/i });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Test User'), 'Wrong Name');
    expect(confirmButton).toBeDisabled();
  });

  it('returns to idle state when cancel is clicked from consequences step', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /delete my account/i }));
    expect(screen.getByText(/permanently deleted/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument();
  });

  it('returns to idle state when cancel is clicked from confirm step', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /delete my account/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.getByRole('button', { name: /delete my account/i })).toBeInTheDocument();
  });

  it('passes the pending request id to cancelAccountDeletion', async () => {
    const user = userEvent.setup();
    getAccountDeletionStatus.mockResolvedValue({
      data: {
        status: 'pending',
        requestId: 'del-42',
        requestedAt: '2026-04-03T12:00:00.000Z',
        scheduledDeletionAt: '2026-04-17T12:00:00.000Z',
        cancelledAt: null,
        completedAt: null,
        reason: 'user_requested',
      },
      error: null,
    });

    renderCard();

    await user.click(await screen.findByRole('button', { name: /cancel deletion/i }));

    await waitFor(() => {
      expect(cancelAccountDeletion).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'del-42' } }),
      );
    });
  });
});
