import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateSportEventRequest } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminGolfTournamentCreatePage } from './root-admin-golf-tournament-create-page';
import { sportEventFixture, sportLeagueFixture } from './golf-test-fixtures';

// plans/124 §6.3 / §4.4a — /manage/golf/tournaments/new (pool-master-3dg). plans/147: a
// tournament is created on a tour, in an event year, where it used to be created in a season.

const {
  createEventFromProviderEventMock,
  createEventMock,
  listSportLeaguesMock,
  listProviderCatalogEventsMock,
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
    createEventFromProviderEventMock: vi.fn(),
    createEventMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listProviderCatalogEventsMock: vi.fn(),
    listProvidersMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  createEvent: createEventMock,
  createEventFromProviderEvent: createEventFromProviderEventMock,
  listSportLeagues: listSportLeaguesMock,
  listProviderCatalogEvents: listProviderCatalogEventsMock,
  listProviders: listProvidersMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderPage(
  entry = '/manage/golf/tournaments/new?sportLeagueId=league-1&eventYear=2026',
  tours = [sportLeagueFixture({ id: 'league-1' }), sportLeagueFixture({ id: 'league-2', name: 'LPGA Tour' })],
) {
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: tours } });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            element={<RootAdminGolfTournamentCreatePage />}
            path="/manage/golf/tournaments/new"
          />
          <Route
            element={<div data-testid="tournament-home">Home</div>}
            path="/manage/golf/tournaments/:eventId"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-3dg RootAdminGolfTournamentCreatePage', () => {
  afterEach(() => {
    createEventMock.mockReset();
    createEventFromProviderEventMock.mockReset();
    listProviderCatalogEventsMock.mockReset();
    listProvidersMock.mockReset();
  });

  it('pool-master-3dg, plans/147: blocks creation with a link to Tours when no active golf tour exists', async () => {
    renderPage('/manage/golf/tournaments/new', [sportLeagueFixture({ id: 'league-1', isActive: false })]);

    expect(
      await screen.findByText('Create a tour before creating a tournament'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('root-admin-golf-tournament-create-tours-link'),
    ).toHaveAttribute('href', '/manage/golf/leagues');
  });

  it('plans/147: defaults the only active tour and its current year when the URL names neither', async () => {
    renderPage('/manage/golf/tournaments/new', [sportLeagueFixture({ id: 'league-1', currentEventYear: 2027 })]);

    await waitFor(() => expect(screen.getByTestId('root-admin-golf-tournament-create-tour')).toHaveValue('league-1'));
    expect(screen.getByTestId('root-admin-golf-tournament-create-event-year')).toHaveValue('2027');
  });

  it('plans/147: shows a second edition of a series in one year as its own refusal, not a generic failure', async () => {
    createEventMock.mockResolvedValue({
      error: { code: 'EVENT_EDITION_ALREADY_EXISTS', message: 'exists' },
      response: { status: 409 },
    });
    renderPage();

    fireEvent.change(await screen.findByTestId('root-admin-golf-tournament-create-name'), { target: { value: 'The Masters' } });
    fireEvent.change(screen.getByTestId('root-admin-golf-tournament-create-start'), { target: { value: '2026-04-09T13:00' } });
    fireEvent.click(screen.getByTestId('root-admin-golf-tournament-create-submit'));

    expect(
      await screen.findByText('This tour already has a 2026 edition of this tournament.'),
    ).toBeInTheDocument();
  });

  it('pool-master-3dg submits a manual tournament with the tour and year prefilled from the URL and navigates Home', async () => {
    createEventMock.mockResolvedValue({
      data: { event: sportEventFixture({ id: 'new-tour' }) },
    });

    renderPage();

    const nameInput = await screen.findByTestId('root-admin-golf-tournament-create-name');
    fireEvent.change(nameInput, { target: { value: 'Spring Classic' } });
    fireEvent.change(screen.getByTestId('root-admin-golf-tournament-create-start'), {
      target: { value: '2026-03-12T13:00' },
    });

    fireEvent.click(screen.getByTestId('root-admin-golf-tournament-create-submit'));

    await waitFor(() =>
      expect(createEventMock).toHaveBeenCalledTimes(1),
    );
    const body = (createEventMock.mock.calls[0][0] as { body: CreateSportEventRequest }).body;
    expect(body.name).toBe('Spring Classic');
    expect(body).toMatchObject({ sportLeagueId: 'league-1', eventYear: 2026 });
    expect(body.startDate).toContain('2026-03-12T');
    expect(body.rounds).toBe(4);
    expect(await screen.findByTestId('tournament-home')).toBeInTheDocument();
  });

  it('pool-master-3dg browses provider events, selects one, and creates a linked tournament', async () => {
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'] }] },
    });
    listProviderCatalogEventsMock.mockResolvedValue({
      data: {
        events: [
          {
            externalId: 'pga-2026-masters',
            name: 'The Masters 2026',
            startDate: '2026-04-09T12:00:00.000Z',
            endDate: '2026-04-12T22:00:00.000Z',
            status: 'SCHEDULED',
          },
        ],
      },
    });
    createEventFromProviderEventMock.mockResolvedValue({
      data: { event: sportEventFixture({ id: 'linked-tour' }) },
    });

    renderPage();

    fireEvent.click(await screen.findByRole('radio', { name: 'Browse provider events' }));

    fireEvent.click(
      await screen.findByTestId(
        'root-admin-golf-tournament-create-select-pga-2026-masters',
      ),
    );

    fireEvent.click(
      await screen.findByTestId('root-admin-golf-tournament-create-provider-submit'),
    );

    await waitFor(() =>
      expect(createEventFromProviderEventMock).toHaveBeenCalledTimes(1),
    );
    const body = (createEventFromProviderEventMock.mock.calls[0][0] as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({
      sportLeagueId: 'league-1',
      eventYear: 2026,
      providerId: 'mock-contest-feed',
      externalId: 'pga-2026-masters',
    });
    expect(await screen.findByTestId('tournament-home')).toBeInTheDocument();
  });
});
