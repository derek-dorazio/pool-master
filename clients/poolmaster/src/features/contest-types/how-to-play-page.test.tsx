import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sportLeagueFixture } from '@/features/root-admin/sport-test-fixtures';
import { bindApiMocks } from '@/test/msw-api';
import { HowToPlayPage } from './how-to-play-page';

const { authState, listContestConfigTemplatesMock, listSportLeaguesMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    authState: { isAuthenticated: false, isLoading: false, isRootAdmin: false, user: null },
    listContestConfigTemplatesMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({ listContestConfigTemplates: listContestConfigTemplatesMock, listSportLeagues: listSportLeaguesMock });

vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => authState }));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function template(templateKey: string, overrides: Record<string, unknown>) {
  return {
    id: `id-${templateKey}`,
    sport: 'GOLF',
    sportLeagueId: null,
    eventType: null,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    templateKey,
    name: `${templateKey} name`,
    description: `${templateKey} description.`,
    sortOrder: 1,
    isDefault: true,
    active: true,
    schemaVersion: 1,
    configuration: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 1 },
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(entry = '/how-to-play') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <HowToPlayPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const GOLF_AND_FOOTBALL = [
  template('golf-tiered-pick-6', {}),
  template('golf-tiered-pick-12', { isDefault: false, sortOrder: 2 }),
  template('nfl-tiered', { sport: 'AMERICAN_FOOTBALL', sportLeagueId: 'nfl' }),
  template('nfl-squares', { sport: 'AMERICAN_FOOTBALL', sportLeagueId: 'nfl', selectionType: 'SQUARES', contestFormat: 'SQUARES', configuration: { selectionType: 'SQUARES', maxSquaresPerEntry: 10, maxEntriesPerSquad: 1 } }),
  template('cfp-tiered', { sport: 'AMERICAN_FOOTBALL', sportLeagueId: 'cfp' }),
];

const SPORT_LEAGUES = [
  sportLeagueFixture({ id: 'pga', sport: 'GOLF', name: 'PGA TOUR' }),
  sportLeagueFixture({ id: 'lpga', sport: 'GOLF', name: 'LPGA Tour' }),
  sportLeagueFixture({ id: 'nfl', sport: 'AMERICAN_FOOTBALL', name: 'NFL' }),
  sportLeagueFixture({ id: 'cfp', sport: 'AMERICAN_FOOTBALL', name: 'College Football Playoff' }),
];

beforeEach(() => {
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: SPORT_LEAGUES } });
});

afterEach(() => {
  listContestConfigTemplatesMock.mockReset();
  listSportLeaguesMock.mockReset();
  authState.isAuthenticated = false;
});

describe('How to Play', () => {
  it('shows a signed-out visitor the three steps, one card for each way to play a template offers, and a way to create an account', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage();

    expect(await screen.findByTestId('how-to-play-format-TIERED')).toHaveTextContent('Tiered');
    expect(screen.getByTestId('how-to-play-steps')).toHaveTextContent('Start a league');
    expect(screen.getByTestId('how-to-play-format-SQUARES')).toHaveTextContent('Squares');
    expect(screen.queryByTestId('how-to-play-format-BRACKET')).not.toBeInTheDocument();
    expect(screen.getByTestId('how-to-play-sport-GOLF')).toHaveTextContent('Golf');
    expect(screen.getByTestId('how-to-play-sport-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('how-to-play-sport-banner')).not.toBeInTheDocument();
    expect(listContestConfigTemplatesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { active: 'true' } }));
    for (const register of screen.getAllByTestId('how-to-play-register')) {
      expect(register).toHaveAttribute('href', '/');
    }
  });

  it('opens a way to play to its three steps and the sports that offer it, and choosing one of those sports narrows the page to it', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage();

    fireEvent.click(await screen.findByTestId('how-to-play-format-TIERED-toggle'));
    const details = screen.getByTestId('how-to-play-format-TIERED-details');
    expect(within(details).getAllByRole('listitem')).toHaveLength(3);
    expect(within(details).getByTestId('how-to-play-format-TIERED-sport-GOLF')).toBeInTheDocument();
    expect(within(details).getByTestId('how-to-play-format-TIERED-sport-AMERICAN_FOOTBALL')).toBeInTheDocument();

    fireEvent.click(within(details).getByTestId('how-to-play-format-TIERED-sport-GOLF'));
    expect(screen.getByTestId('location')).toHaveTextContent('/how-to-play?sport=golf');
    expect(screen.getByTestId('how-to-play-sport-GOLF')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('how-to-play-format-SQUARES')).not.toBeInTheDocument();
  });

  it('narrows the page to the sport its link names: that sport\'s picture and line, only its ways to play, and its default template inside each', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage('/how-to-play?sport=american-football');

    const banner = await screen.findByTestId('how-to-play-sport-banner');
    expect(banner).toHaveTextContent('American football');
    expect(banner).toHaveTextContent('Weekly pick\'em and survivor');
    expect(screen.getByTestId('how-to-play-format-SQUARES')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('how-to-play-format-SQUARES-toggle'));
    expect(screen.getByTestId('how-to-play-format-SQUARES-details')).toHaveTextContent('nfl-squares name. nfl-squares description.');

    fireEvent.click(screen.getByTestId('how-to-play-sport-all'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/how-to-play$/);
    expect(screen.queryByTestId('how-to-play-sport-banner')).not.toBeInTheDocument();
  });

  it('names each sport\'s leagues as chips grouped under their sport, in the platform\'s sport order and by name within one', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage();

    const golf = await screen.findByTestId('how-to-play-sport-group-GOLF');
    expect(within(golf).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['Golf', 'LPGA Tour', 'PGA TOUR']);
    const football = screen.getByTestId('how-to-play-sport-group-AMERICAN_FOOTBALL');
    expect(within(football).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['American football', 'College Football Playoff', 'NFL']);
    expect(golf.compareDocumentPosition(football) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('narrows the page to a chosen league: its name over its sport\'s picture, only the ways to play it offers, and its own template inside each, kept in the link', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage();

    fireEvent.click(await screen.findByTestId('how-to-play-league-AMERICAN_FOOTBALL-college-football-playoff'));
    expect(screen.getByTestId('location')).toHaveTextContent('/how-to-play?sport=american-football&league=college-football-playoff');
    expect(screen.getByTestId('how-to-play-league-AMERICAN_FOOTBALL-college-football-playoff')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('how-to-play-sport-AMERICAN_FOOTBALL')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('how-to-play-sport-banner')).toHaveTextContent('College Football Playoff');
    expect(screen.queryByTestId('how-to-play-format-SQUARES')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('how-to-play-format-TIERED-toggle'));
    expect(screen.getByTestId('how-to-play-format-TIERED-details')).toHaveTextContent('cfp-tiered name. cfp-tiered description.');
  });

  it('opens on the league its link names, and choosing the league\'s sport widens the page to every league of it', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage('/how-to-play?sport=american-football&league=nfl');

    expect(await screen.findByTestId('how-to-play-sport-banner')).toHaveTextContent('NFL');
    expect(screen.getByTestId('how-to-play-league-AMERICAN_FOOTBALL-nfl')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('how-to-play-sport-AMERICAN_FOOTBALL'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/how-to-play\?sport=american-football$/);
    expect(screen.getByTestId('how-to-play-sport-AMERICAN_FOOTBALL')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('how-to-play-league-AMERICAN_FOOTBALL-nfl')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('how-to-play-sport-banner')).toHaveTextContent('American football');
  });

  it('shows every sport when the link names a sport with no contest types', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage('/how-to-play?sport=curling');

    expect(await screen.findByTestId('how-to-play-format-SQUARES')).toBeInTheDocument();
    expect(screen.getByTestId('how-to-play-sport-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('how-to-play-sport-banner')).not.toBeInTheDocument();
  });

  it('sends a signed-in member to their leagues instead of to registration', async () => {
    authState.isAuthenticated = true;
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [template('golf-tiered-pick-6', {})] } });
    renderPage();

    await screen.findByTestId('how-to-play-format-TIERED');
    expect(screen.getByTestId('how-to-play-leagues')).toHaveAttribute('href', '/welcome');
    expect(screen.queryByTestId('how-to-play-register')).not.toBeInTheDocument();
  });

  it('says the contest types could not be loaded when the template list fails', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'boom' } }, response: { status: 500 } });
    renderPage();

    expect(await screen.findByText('Contest types unavailable')).toBeInTheDocument();
  });

  it('says the contest types could not be loaded when the sport league list fails', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    listSportLeaguesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'boom' } }, response: { status: 500 } });
    renderPage();

    expect(await screen.findByText('Contest types unavailable')).toBeInTheDocument();
  });
});
