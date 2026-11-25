import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RunDrawAction } from './run-draw-action';

const { mockLogger, runContestDrawMock } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return { mockLogger: logger, runContestDrawMock: vi.fn() };
});

bindApiMocks({ runContestDraw: runContestDrawMock });

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderAction() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RunDrawAction contestId="contest-1" entryCount={3} leagueId="league-1" noun={{ one: 'golfer', many: 'golfers' }} picksPerEntry={2} />
    </QueryClientProvider>,
  );
}

function openAndConfirm() {
  fireEvent.click(screen.getByTestId('contest-run-draw'));
  fireEvent.click(screen.getByTestId('contest-run-draw-confirm'));
}

describe('RunDrawAction', () => {
  afterEach(() => {
    runContestDrawMock.mockReset();
    vi.clearAllMocks();
  });

  it('asks first, saying how many each entry is dealt, then runs the draw and closes', async () => {
    runContestDrawMock.mockResolvedValue({ data: { contest: { id: 'contest-1' } } });
    renderAction();

    fireEvent.click(screen.getByTestId('contest-run-draw'));
    expect(screen.getByTestId('contest-run-draw-dialog')).toHaveTextContent('deals each of the 3 entries 2 golfers at random');
    fireEvent.click(screen.getByTestId('contest-run-draw-confirm'));

    await waitFor(() => expect(screen.queryByTestId('contest-run-draw-dialog')).not.toBeInTheDocument());
    expect(runContestDrawMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1' } }));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({ action: 'contest.draw.succeeded' }), expect.any(String));
  });

  it('keeps the dialog open with the refusal, logged as a warning, and clears it once closed', async () => {
    runContestDrawMock.mockResolvedValue({ error: { error: { code: 'CONTEST_DRAW_ALREADY_RUN', message: 'The draw already ran.' } }, status: 409 });
    renderAction();

    openAndConfirm();

    expect(await screen.findByTestId('contest-run-draw-error')).toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'contest.draw.failed' }), expect.any(String));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('contest-run-draw-dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId('contest-run-draw'));
    expect(screen.queryByTestId('contest-run-draw-error')).not.toBeInTheDocument();
  });

  it('logs a request that never got a response as unexpected', async () => {
    // A mock that answers nothing stands for a request that never got a response.
    runContestDrawMock.mockResolvedValue(undefined);
    renderAction();

    openAndConfirm();

    await waitFor(() => expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'contest.draw.failed' }), expect.any(String)));
  });

  it('stays open on Escape while the draw is still running', async () => {
    runContestDrawMock.mockReturnValue(new Promise(() => undefined));
    renderAction();

    openAndConfirm();
    await screen.findByText('Drawing...');
    await userEvent.keyboard('{Escape}');

    expect(screen.getByTestId('contest-run-draw-dialog')).toBeInTheDocument();
  });
});
