import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { Toaster } from '@/features/shared/ui';
import { DeleteContestDialog } from './delete-contest-dialog';

const { mockLogger, deleteContestMock } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return { mockLogger: logger, deleteContestMock: vi.fn() };
});

bindApiMocks({ deleteContest: deleteContestMock });

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderDialog() {
  const onOpenChange = vi.fn();
  const onDeleted = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DeleteContestDialog
        contestId="contest-1"
        contestName="Masters Pool"
        leagueCode="BIGDAWGS"
        leagueId="league-1"
        onDeleted={onDeleted}
        onOpenChange={onOpenChange}
        open
      />
      <Toaster />
    </QueryClientProvider>,
  );
  return { onDeleted, onOpenChange };
}

function confirmDelete() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete contest' }));
}

describe('DeleteContestDialog', () => {
  afterEach(() => {
    deleteContestMock.mockReset();
    vi.clearAllMocks();
  });

  it('deletes the contest, closes, says so in a toast and goes where the caller asked', async () => {
    deleteContestMock.mockResolvedValue({ data: undefined });
    const { onDeleted, onOpenChange } = renderDialog();

    confirmDelete();

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(deleteContestMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1' } }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(await screen.findByTestId('app-toast')).toHaveTextContent('Masters Pool deleted');
  });

  it('keeps the dialog open with the refusal and logs it as a warning when the API refuses', async () => {
    deleteContestMock.mockResolvedValue({ error: { error: { code: 'CONTEST_NOT_DRAFT', message: 'Opened contests stay.' } }, status: 409 });
    const { onOpenChange } = renderDialog();

    confirmDelete();

    await waitFor(() => expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'contest.delete.failed' }), 'Contest delete was rejected'));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('logs a failure that is not an API refusal as unexpected, and shows the fallback message', async () => {
    // A mock that answers nothing stands for a request that never got a response.
    deleteContestMock.mockResolvedValue(undefined);
    renderDialog();

    confirmDelete();

    await waitFor(() => expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'contest.delete.failed' }), 'Contest delete failed unexpectedly'));
  });

  it('stays open on Escape while the delete is still running', async () => {
    let finish: (value: { data: undefined }) => void = () => undefined;
    deleteContestMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onOpenChange } = renderDialog();

    confirmDelete();
    await screen.findByText('Deleting...');
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();

    finish({ data: undefined });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('closes on Escape before anything is sent', async () => {
    const { onOpenChange } = renderDialog();

    await userEvent.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(deleteContestMock).not.toHaveBeenCalled();
  });
});
