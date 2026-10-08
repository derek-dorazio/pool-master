import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { GolfTournamentProviderBrowse } from './golf-tournament-provider-browse';
import { sportEventFixture, sportLeagueFixture } from './golf-test-fixtures';
import type { GolfTournamentEdition } from './golf-tournament-edition';

// plans/124 §4.4 — "Browse provider events" on the create page: the golf provider's catalog,
// then one provider event turned into a linked tournament.

const { createEventFromProviderEventMock, listProviderCatalogEventsMock, listProvidersMock, mockLogger } = vi.hoisted(() => {
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
    listProviderCatalogEventsMock: vi.fn(),
    listProvidersMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  createEventFromProviderEvent: createEventFromProviderEventMock,
  listProviderCatalogEvents: listProviderCatalogEventsMock,
  listProviders: listProvidersMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const TOURS = [sportLeagueFixture({ id: 'league-1', name: 'PGA Tour' })];
const COMPLETE_EDITION: GolfTournamentEdition = { sportLeagueId: 'league-1', eventYear: '2026' };
const MASTERS = {
  externalId: 'pga-2026-masters',
  name: 'The Masters 2026',
  startDate: '2026-04-09T12:00:00.000Z',
  endDate: '2026-04-12T22:00:00.000Z',
  status: 'SCHEDULED',
};

function withGolfProvider() {
  listProvidersMock.mockResolvedValue({
    data: { providers: [{ providerId: 'mock-contest-feed', sportsCovered: ['GOLF'] }] },
  });
}

function renderBrowse(edition: GolfTournamentEdition = COMPLETE_EDITION) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/manage/golf/tournaments/new']}>
        <Routes>
          <Route
            element={<GolfTournamentProviderBrowse edition={edition} onEditionChange={vi.fn()} tours={TOURS} />}
            path="/manage/golf/tournaments/new"
          />
          <Route element={<div data-testid="tournament-home">Home</div>} path="/manage/golf/tournaments/:eventId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function selectMasters() {
  fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-create-select-pga-2026-masters'));
}

describe('GolfTournamentProviderBrowse', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('says there is no catalog to browse when no provider covers golf', async () => {
    listProvidersMock.mockResolvedValue({
      data: { providers: [{ providerId: 'nfl-feed', sportsCovered: ['NFL'] }] },
    });
    renderBrowse();

    expect(await screen.findByText(/No provider is registered for golf/)).toBeInTheDocument();
    expect(listProviderCatalogEventsMock).not.toHaveBeenCalled();
  });

  it('says there is no catalog to browse when the provider list cannot be read', async () => {
    listProvidersMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Provider registry unavailable.' } },
      response: { status: 500 },
    });
    renderBrowse();

    expect(await screen.findByText(/No provider is registered for golf/)).toBeInTheDocument();
  });

  it('shows the server\'s reason when the provider catalog cannot be loaded', async () => {
    withGolfProvider();
    listProviderCatalogEventsMock.mockResolvedValue({
      error: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'The golf feed is not answering.' } },
      response: { status: 502 },
    });
    renderBrowse();

    expect(await screen.findByText('The golf feed is not answering.')).toBeInTheDocument();
  });

  it('browses every tour, with no tour filter, when the edition names no tour yet', async () => {
    withGolfProvider();
    listProviderCatalogEventsMock.mockResolvedValue({ data: { events: [] } });
    renderBrowse({ sportLeagueId: '', eventYear: '' });

    await waitFor(() => expect(listProviderCatalogEventsMock).toHaveBeenCalled());
    expect(await screen.findByText('No provider events fall in this window.')).toBeInTheDocument();
    expect(screen.queryByText(/Filtered to/)).not.toBeInTheDocument();
    const { query } = listProviderCatalogEventsMock.mock.calls[0][0] as { query: Record<string, unknown> };
    expect(query).not.toHaveProperty('sportLeagueId');
  });

  it('filters the catalog to the chosen tour and returns from a selected event to the list with Change', async () => {
    withGolfProvider();
    listProviderCatalogEventsMock.mockResolvedValue({ data: { events: [MASTERS] } });
    renderBrowse();

    expect(await screen.findByText('Filtered to PGA Tour.')).toBeInTheDocument();
    await selectMasters();
    expect(await screen.findByText('Provider event')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    expect(await screen.findByTestId('root-admin-golf-tournament-create-select-pga-2026-masters')).toBeInTheDocument();
    expect((listProviderCatalogEventsMock.mock.calls[0][0] as { query: Record<string, unknown> }).query)
      .toMatchObject({ sport: 'GOLF', sportLeagueId: 'league-1' });
  });

  it('leaves the round count out of the request when the rounds field is cleared, and opens the new tournament', async () => {
    withGolfProvider();
    listProviderCatalogEventsMock.mockResolvedValue({ data: { events: [MASTERS] } });
    createEventFromProviderEventMock.mockResolvedValue({ data: { event: sportEventFixture({ id: 'linked-1' }) } });
    renderBrowse();

    await selectMasters();
    fireEvent.change(await screen.findByTestId('root-admin-golf-tournament-create-provider-rounds'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('root-admin-golf-tournament-create-provider-submit'));

    await waitFor(() => expect(createEventFromProviderEventMock).toHaveBeenCalledTimes(1));
    expect((createEventFromProviderEventMock.mock.calls[0][0] as { body: Record<string, unknown> }).body).toEqual({
      sportLeagueId: 'league-1',
      eventYear: 2026,
      providerId: 'mock-contest-feed',
      externalId: 'pga-2026-masters',
    });
    expect(await screen.findByTestId('tournament-home')).toBeInTheDocument();
  });

  it('says the tour already has this year\'s edition when the provider tournament is a duplicate', async () => {
    withGolfProvider();
    listProviderCatalogEventsMock.mockResolvedValue({ data: { events: [MASTERS] } });
    createEventFromProviderEventMock.mockResolvedValue({
      error: { error: { code: 'EVENT_EDITION_ALREADY_EXISTS', message: 'exists' } },
      response: { status: 409 },
    });
    renderBrowse();

    await selectMasters();
    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-create-provider-submit'));

    expect(
      await screen.findByText('This tour already has a 2026 edition of this tournament.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('tournament-home')).not.toBeInTheDocument();
  });

  it('shows the server\'s reason when creating the linked tournament is refused for another cause', async () => {
    withGolfProvider();
    listProviderCatalogEventsMock.mockResolvedValue({ data: { events: [MASTERS] } });
    createEventFromProviderEventMock.mockResolvedValue({
      error: { error: { code: 'PROVIDER_EVENT_NOT_FOUND', message: 'Provider mock-contest-feed has no event pga-2026-masters.' } },
      response: { status: 404 },
    });
    renderBrowse();

    await selectMasters();
    fireEvent.click(await screen.findByTestId('root-admin-golf-tournament-create-provider-submit'));

    expect(
      await screen.findByText('Provider mock-contest-feed has no event pga-2026-masters.'),
    ).toBeInTheDocument();
  });

  it('keeps Create disabled until the edition names a tour and a four-digit year', async () => {
    withGolfProvider();
    listProviderCatalogEventsMock.mockResolvedValue({ data: { events: [MASTERS] } });
    renderBrowse({ sportLeagueId: 'league-1', eventYear: '26' });

    await selectMasters();

    expect(await screen.findByTestId('root-admin-golf-tournament-create-provider-submit')).toBeDisabled();
  });
});
