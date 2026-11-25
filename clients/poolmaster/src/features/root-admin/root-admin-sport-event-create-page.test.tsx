import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateSportEventRequest } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportEventCreatePage } from './root-admin-sport-event-create-page';
import { sportEventFixture, sportLeagueFixture, sportsQueryClient } from './sport-test-fixtures';

// plans/124 §6.3 / §4.4a — /manage/sports/golf/events/new (pool-master-3dg). plans/147: a
// tournament is created on a tour, in an event year, where it used to be created in a season.

const {
  createEventMock,
  listSportLeaguesMock,
  listProvidersMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return {
    createEventMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listProvidersMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  createEvent: createEventMock,
  listSportLeagues: listSportLeaguesMock,
  listProviders: listProvidersMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderPage(
  entry = '/manage/sports/golf/events/new?sportLeagueId=league-1',
  tours = [sportLeagueFixture({ id: 'league-1' }), sportLeagueFixture({ id: 'league-2', name: 'LPGA Tour' })],
) {
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: tours } });
  const queryClient = sportsQueryClient(new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            element={<RootAdminSportEventCreatePage />}
            path="/manage/sports/:sport/events/new"
          />
          <Route
            element={<div data-testid="tournament-home">Home</div>}
            path="/manage/sports/:sport/events/:eventId"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-3dg RootAdminSportEventCreatePage', () => {
  afterEach(() => {
    createEventMock.mockReset();
    listProvidersMock.mockReset();
  });

  it('blocks creation, with no link to make a tour, when no active golf tour exists', async () => {
    renderPage('/manage/sports/golf/events/new', [sportLeagueFixture({ id: 'league-1', isActive: false })]);

    expect(
      await screen.findByText('No active tour for a tournament'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-sport-event-create-tours-link')).not.toBeInTheDocument();
  });

  it('defaults the only active tour when the URL names none, and asks for no year: the event goes in the tour\'s current Season', async () => {
    renderPage('/manage/sports/golf/events/new', [sportLeagueFixture({ id: 'league-1' })]);

    await waitFor(() => expect(screen.getByTestId('root-admin-sport-event-create-tour')).toHaveValue('league-1'));
    expect(screen.queryByTestId('root-admin-sport-event-create-event-year')).not.toBeInTheDocument();
  });

  it('shows a second edition of a series in one Season as its own refusal, not a generic failure', async () => {
    createEventMock.mockResolvedValue({
      error: { error: { code: 'EVENT_EDITION_ALREADY_EXISTS', message: 'exists' } },
      response: { status: 409 },
    });
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-sport-event-create-name'), { target: { value: 'The Masters' } });
    fireEvent.change(screen.getByTestId('root-admin-sport-event-create-start'), { target: { value: '2026-04-09T13:00' } });
    fireEvent.click(screen.getByTestId('root-admin-sport-event-create-submit'));

    expect(
      await screen.findByText('This tour already has this tournament in its current Season.'),
    ).toBeInTheDocument();
  });

  it('submits a manual tournament with the tour prefilled from the URL and no year, and navigates Home', async () => {
    createEventMock.mockResolvedValue({
      data: { event: sportEventFixture({ id: 'new-tour' }) },
    });

    renderPage();

    const nameInput = await screen.findByTestId('root-admin-sport-event-create-name');
    fireEvent.change(nameInput, { target: { value: 'Spring Classic' } });
    fireEvent.change(screen.getByTestId('root-admin-sport-event-create-start'), {
      target: { value: '2026-03-12T13:00' },
    });

    fireEvent.click(screen.getByTestId('root-admin-sport-event-create-submit'));

    await waitFor(() =>
      expect(createEventMock).toHaveBeenCalledTimes(1),
    );
    const body = (createEventMock.mock.calls[0][0] as { body: CreateSportEventRequest }).body;
    expect(body.name).toBe('Spring Classic');
    expect(body).toMatchObject({ sportLeagueId: 'league-1' });
    expect(body).not.toHaveProperty('eventYear');
    expect(body.startDate).toContain('2026-03-12T');
    expect(body.rounds).toBe(4);
    expect(await screen.findByTestId('tournament-home')).toBeInTheDocument();
  });

  it('offers only the hand-made form, with no way to browse or link a provider\'s events', async () => {
    renderPage();

    expect(await screen.findByTestId('root-admin-sport-event-create-header')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Browse provider events' })).not.toBeInTheDocument();
  });
});
