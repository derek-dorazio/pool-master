import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { OpenContestAction } from './open-contest-action';

const { mockLogger, openContestMock } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockImplementation(() => logger);
  return { mockLogger: logger, openContestMock: vi.fn() };
});

bindApiMocks({ openContest: openContestMock });

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderAction() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OpenContestAction contestId="contest-1" leagueId="league-1" />
    </QueryClientProvider>,
  );
}

async function confirmOpen() {
  fireEvent.click(screen.getByTestId('contest-open-to-league'));
  fireEvent.click(await screen.findByTestId('contest-open-confirm'));
}

describe('OpenContestAction', () => {
  afterEach(() => {
    openContestMock.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  it('asks first, then opens the contest for its league and closes the dialog', async () => {
    openContestMock.mockResolvedValue({ data: { contest: { id: 'contest-1', status: 'OPEN' } } });

    renderAction();
    await confirmOpen();

    await waitFor(() => {
      expect(openContestMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 'league-1', contestId: 'contest-1' } }),
      );
    });
    await waitFor(() => expect(screen.queryByTestId('contest-open-dialog')).not.toBeInTheDocument());
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contest.open.succeeded' }),
      expect.any(String),
    );
  });

  it('keeps the dialog open with the release copy when the event has already started, and clears it on cancel', async () => {
    openContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_EVENT_ALREADY_STARTED', message: 'Event started.' } },
      status: 409,
    });

    renderAction();
    await confirmOpen();

    expect(await screen.findByTestId('contest-open-error')).toHaveTextContent(
      /event has already started, so it can no longer be opened/i,
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contest.open.failed' }),
      expect.any(String),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('contest-open-dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('contest-open-to-league'));
    await screen.findByTestId('contest-open-confirm');
    expect(screen.queryByTestId('contest-open-error')).not.toBeInTheDocument();
  });

  it('keeps the dialog open with an error and logs it as unexpected when the response carries no contest', async () => {
    openContestMock.mockResolvedValue({ data: {} });

    renderAction();
    await confirmOpen();

    expect(await screen.findByTestId('contest-open-error')).toBeInTheDocument();
    expect(screen.getByTestId('contest-open-dialog')).toBeInTheDocument();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contest.open.failed' }),
      expect.any(String),
    );
  });
});
