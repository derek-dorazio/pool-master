import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminMapCompetitorPage } from './root-admin-map-competitor-page';
import { RootAdminUnmappedParticipantsPage } from './root-admin-unmapped-participants-page';

const {
  listUnmappedProviderParticipantsMock,
  listSportsMock,
  listParticipantsMock,
  bindParticipantProviderMappingMock,
  mockLogger,
} = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);

  return {
    listUnmappedProviderParticipantsMock: vi.fn(),
    listSportsMock: vi.fn(),
    listParticipantsMock: vi.fn(),
    bindParticipantProviderMappingMock: vi.fn(),
    mockLogger,
  };
});

bindApiMocks({
  listUnmappedProviderParticipants: listUnmappedProviderParticipantsMock,
  listSports: listSportsMock,
  listParticipants: listParticipantsMock,
  bindParticipantProviderMapping: bindParticipantProviderMappingMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const COMPETITOR = {
  providerId: 'mock-contest-feed',
  providerName: 'Mock contest feed',
  externalId: 'golfer-77',
  externalName: 'Ludvig Aberg',
  sport: 'GOLF',
};

const MAP_PATH = '/manage/sync/unmapped-participants/map?provider=mock-contest-feed&competitor=golfer-77';

function renderPage(path = '/manage/sync/unmapped-participants') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<RootAdminUnmappedParticipantsPage />} path="/manage/sync/unmapped-participants" />
          <Route element={<RootAdminMapCompetitorPage />} path="/manage/sync/unmapped-participants/map" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminUnmappedParticipantsPage', () => {
  beforeEach(() => {
    listUnmappedProviderParticipantsMock.mockReset();
    listSportsMock.mockReset();
    listParticipantsMock.mockReset();
    bindParticipantProviderMappingMock.mockReset();

    listUnmappedProviderParticipantsMock.mockResolvedValue({ data: { participants: [COMPETITOR] } });
    listSportsMock.mockResolvedValue({ data: { sports: [{ id: 'sport-golf', name: 'GOLF' }] } });
    listParticipantsMock.mockResolvedValue({
      data: { participants: [{ id: 'participant-1', name: 'Ludvig Åberg', nationality: 'SWE' }] },
    });
    bindParticipantProviderMappingMock.mockResolvedValue({
      data: {
        providerMapping: {
          id: 'mapping-1',
          participantId: 'participant-1',
          providerId: COMPETITOR.providerId,
          externalId: COMPETITOR.externalId,
          confidence: 'MANUAL',
          mappedAt: '2026-09-30T12:00:00.000Z',
        },
      },
    });
  });

  it('lists each competitor a provider could not match, with the provider and its id', async () => {
    renderPage();

    const row = await screen.findByTestId('root-admin-unmapped-participant-row-mock-contest-feed:golfer-77');
    expect(row).toHaveTextContent('Ludvig Aberg');
    expect(row).toHaveTextContent('Mock contest feed');
    expect(row).toHaveTextContent('golfer-77');
  });

  it('says every competitor is mapped when the provider reports none unmatched', async () => {
    listUnmappedProviderParticipantsMock.mockResolvedValue({ data: { participants: [] } });

    renderPage();

    expect(
      await screen.findByText('Every competitor the providers report is mapped to a participant.'),
    ).toBeInTheDocument();
  });

  it('opens Map competitor on its own page for the row\'s provider and id', async () => {
    renderPage();

    expect(
      await screen.findByTestId('root-admin-unmapped-participant-map-mock-contest-feed:golfer-77'),
    ).toHaveAttribute('href', MAP_PATH);
  });

  it('narrows the unmapped list with the search box', async () => {
    listUnmappedProviderParticipantsMock.mockResolvedValue({
      data: {
        participants: [
          COMPETITOR,
          { ...COMPETITOR, externalId: 'golfer-88', externalName: 'Tom Kim' },
        ],
      },
    });
    renderPage();
    await screen.findByText('Tom Kim');

    fireEvent.change(screen.getByTestId('root-admin-unmapped-participants-search'), {
      target: { value: 'Tom' },
    });

    await waitFor(() => expect(screen.queryByText('Ludvig Aberg')).not.toBeInTheDocument());
    expect(screen.getByText('Tom Kim')).toBeInTheDocument();
  });

  it('binds the competitor\'s provider identity to the chosen participant of the same sport, then returns to the refreshed list', async () => {
    renderPage(MAP_PATH);

    expect(await screen.findByTestId('root-admin-unmapped-participant-map-page')).toBeInTheDocument();
    // The search starts from the provider's spelling, scoped to the competitor's sport.
    expect(screen.getByTestId('root-admin-unmapped-participant-map-search')).toHaveValue('Ludvig Aberg');
    await waitFor(() => {
      expect(listParticipantsMock).toHaveBeenCalledWith({ query: { sportId: 'sport-golf', q: 'Ludvig Aberg' } });
    });
    expect(screen.getByTestId('root-admin-unmapped-participant-map-save')).toBeDisabled();

    const picker = screen.getByTestId('root-admin-unmapped-participant-map-participant');
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.change(picker, { target: { value: 'participant-1' } });
    listUnmappedProviderParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    fireEvent.click(screen.getByTestId('root-admin-unmapped-participant-map-save'));

    await waitFor(() => {
      expect(bindParticipantProviderMappingMock).toHaveBeenCalledWith({
        path: { id: 'participant-1' },
        body: { providerId: 'mock-contest-feed', externalId: 'golfer-77' },
      });
    });
    expect(
      await screen.findByText('Every competitor the providers report is mapped to a participant.'),
    ).toBeInTheDocument();
  });

  it('keeps Map competitor open with the server\'s reason when the mapping is refused', async () => {
    bindParticipantProviderMappingMock.mockResolvedValue({
      error: { error: { code: 'CONFLICT', message: 'This participant already has a mapping for this provider.' } },
      response: { status: 409 },
    });
    renderPage(MAP_PATH);

    const picker = await screen.findByTestId('root-admin-unmapped-participant-map-participant');
    await waitFor(() => expect(picker).toBeEnabled());
    fireEvent.change(picker, { target: { value: 'participant-1' } });
    fireEvent.click(screen.getByTestId('root-admin-unmapped-participant-map-save'));

    expect(
      await screen.findByText('This participant already has a mapping for this provider.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-unmapped-participant-map-page')).toBeInTheDocument();
  });

  it('returns to the unmapped list from Map competitor\'s Cancel without mapping anyone', async () => {
    renderPage(MAP_PATH);

    fireEvent.click(await screen.findByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('root-admin-unmapped-participants-page')).toBeInTheDocument();
    expect(bindParticipantProviderMappingMock).not.toHaveBeenCalled();
  });

  it('says there is nothing to map when the competitor is no longer unmapped', async () => {
    listUnmappedProviderParticipantsMock.mockResolvedValue({ data: { participants: [] } });
    renderPage(MAP_PATH);

    expect(
      await screen.findByText('This competitor is already mapped, or the provider no longer reports them.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-unmapped-participant-map-save')).not.toBeInTheDocument();
  });
});
