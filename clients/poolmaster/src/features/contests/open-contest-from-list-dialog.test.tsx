import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContestDto, SportEventDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { apiSuccess } from '@/features/leagues/test/fixtures';
import { OpenContestFromListDialog } from './open-contest-from-list-dialog';
import { buildContest, buildSportEvent } from './test/contest-admin-fixtures';

const getEventMock = vi.fn();
const openContestMock = vi.fn();

bindApiMocks({
  getEvent: getEventMock,
  openContest: openContestMock,
});

function renderDialog(contest: ContestDto = buildContest(), open = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OpenContestFromListDialog contest={contest} onOpenChange={() => undefined} open={open} />
    </QueryClientProvider>,
  );
}

function primeEvent(overrides: Partial<SportEventDto> = {}) {
  getEventMock.mockResolvedValue(apiSuccess({ event: buildSportEvent(overrides) }));
}

describe('OpenContestFromListDialog', () => {
  afterEach(() => {
    for (const mock of [getEventMock, openContestMock]) {
      mock.mockReset();
    }
  });

  it('reads nothing while it is closed', () => {
    primeEvent();
    renderDialog(buildContest(), false);

    expect(getEventMock).not.toHaveBeenCalled();
  });

  it('shows the contest page\'s readiness checks under the question and lets a ready contest open', async () => {
    primeEvent();
    openContestMock.mockResolvedValue(apiSuccess({ contest: buildContest({ status: 'OPEN' }) }));
    renderDialog();

    const checks = await screen.findByTestId('contest-open-readiness-checks');
    expect(within(checks).getByTestId('contest-open-readiness-released')).toHaveTextContent('Event released');
    expect(within(checks).getByTestId('contest-open-readiness-field')).toHaveTextContent('89 golfers in 6 tiers');
    expect(within(checks).getByTestId('contest-open-readiness-not-started')).toHaveAttribute('data-met', 'true');
    expect(getEventMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'event-1' } }));

    await userEvent.click(screen.getByTestId('contest-open-confirm'));
    await waitFor(() => expect(openContestMock).toHaveBeenCalled());
  });

  it('holds Open while the event is not released, and says which check is missing', async () => {
    primeEvent({ readinessStatus: 'NOT_RELEASED', readinessReasons: ['EVENT_NOT_RELEASED'], contestEligible: false });
    renderDialog();

    expect(await screen.findByTestId('contest-open-readiness-released')).toHaveAttribute('data-met', 'false');
    expect(screen.getByTestId('contest-open-readiness-released')).toHaveTextContent('Event not released yet');
    expect(screen.getByTestId('contest-open-confirm')).toBeDisabled();
  });

  it('holds Open while the checks load', () => {
    getEventMock.mockReturnValue(new Promise(() => undefined));
    renderDialog();

    expect(screen.getByTestId('contest-open-readiness-loading')).toBeInTheDocument();
    expect(screen.getByTestId('contest-open-confirm')).toBeDisabled();
  });

  it('says the checks could not be read, offers to try again, and still lets the server decide', async () => {
    getEventMock.mockResolvedValueOnce({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } } });
    renderDialog();

    expect(await screen.findByTestId('contest-open-readiness-error')).toHaveTextContent('We couldn\'t check whether this contest is ready.');
    expect(screen.getByTestId('contest-open-confirm')).toBeEnabled();

    primeEvent();
    await userEvent.click(within(screen.getByTestId('contest-open-readiness-error')).getByRole('button'));
    expect(await screen.findByTestId('contest-open-readiness-checks')).toBeInTheDocument();
  });
});
