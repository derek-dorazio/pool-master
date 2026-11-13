import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeagueRole } from '@poolmaster/shared/domain';
import { buildLeague, buildLeagueMembership, listLeaguesData } from '@/features/leagues/test/fixtures';
import { sportLeagueFixture } from '@/features/root-admin/sport-test-fixtures';
import { bindApiMocks } from '@/test/msw-api';
import { championshipWeekendFixture } from '@/features/event-pages/event-page-test-fixtures';
import { HowToPlayPage } from './how-to-play-page';

const { authState, listContestConfigTemplatesMock, listEventPagesMock, listLeaguesMock, listSportLeaguesMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    authState: { isAuthenticated: false, isLoading: false, isRootAdmin: false, user: null },
    listContestConfigTemplatesMock: vi.fn(),
    listEventPagesMock: vi.fn(),
    listLeaguesMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({ listContestConfigTemplates: listContestConfigTemplatesMock, listEventPages: listEventPagesMock, listLeagues: listLeaguesMock, listSportLeagues: listSportLeaguesMock });

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
  sportLeagueFixture({ id: 'lpga', sport: 'GOLF', name: 'LPGA Tour', displayOrder: 20 }),
  sportLeagueFixture({ id: 'pga', sport: 'GOLF', name: 'PGA TOUR', displayOrder: 10 }),
  sportLeagueFixture({ id: 'cfp', sport: 'AMERICAN_FOOTBALL', name: 'College Football Playoff', displayOrder: 20 }),
  sportLeagueFixture({ id: 'nfl', sport: 'AMERICAN_FOOTBALL', name: 'NFL', displayOrder: 10 }),
];

beforeEach(() => {
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: SPORT_LEAGUES } });
  listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
});

afterEach(() => {
  listContestConfigTemplatesMock.mockReset();
  listSportLeaguesMock.mockReset();
  listEventPagesMock.mockReset();
  listLeaguesMock.mockReset();
  authState.isAuthenticated = false;
});

/** Signs the viewer in to these leagues, in `role` in each. */
function signInTo(leagues: ReturnType<typeof buildLeague>[], role: LeagueRole = LeagueRole.COMMISSIONER) {
  authState.isAuthenticated = true;
  listLeaguesMock.mockResolvedValue({
    data: listLeaguesData(leagues, leagues.map((league) => buildLeagueMembership({ id: `m-${league.id}`, leagueId: league.id, role }))),
  });
}

/** The column of every sport and league beside the ways to play, on a computer. */
function leaguesColumn() {
  return screen.getByRole('navigation', { name: 'Sports and leagues' });
}

/** The column's lines, as their words. */
function columnLines() {
  return within(leaguesColumn()).getAllByRole('link').map((link) => link.textContent);
}

/** The line or chip the page shows as chosen. */
function chosenIn(container: HTMLElement) {
  return within(container).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent);
}

/** The ways to play's heading: "3 ways to play hockey". */
async function waysToPlayHeading() {
  return within(await screen.findByTestId('how-to-play-formats')).getAllByRole('heading', { level: 2 })[0];
}

describe('How to Play', () => {
  it('zooms in on a chosen sport\'s coming events: a Coming up card per event page, linking to it', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture()] } });
    renderPage('/how-to-play?sport=american-football');

    expect(await screen.findByTestId('how-to-play-coming-up-championship-weekend')).toHaveAttribute('href', '/play/american-football/championship-weekend');
    expect(listEventPagesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sport: 'AMERICAN_FOOTBALL', upcoming: 'true' } }));
  });

  it('shows a signed-out visitor the ways to play first, counted in their heading, beside every sport, with the three steps as one slim strip and a way to create an account', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage();

    expect(await screen.findByTestId('how-to-play-format-TIERED')).toHaveTextContent('Tiered');
    expect(await waysToPlayHeading()).toHaveTextContent('2 ways to play');
    expect(screen.getByTestId('how-to-play-steps')).toHaveTextContent('Start a league');
    expect(screen.getByTestId('how-to-play-steps')).toHaveTextContent('Pick a contest');
    // The slim strip names each step and says nothing more.
    expect(screen.getByTestId('how-to-play-steps')).not.toHaveTextContent('invites everyone with one link');
    expect(screen.getByTestId('how-to-play-format-SQUARES')).toHaveTextContent('Squares');
    expect(screen.getByTestId('how-to-play-format-SQUARES')).toHaveTextContent('Claim squares on a 10 × 10 grid.');
    expect(screen.queryByTestId('how-to-play-format-BRACKET')).not.toBeInTheDocument();
    expect(chosenIn(leaguesColumn())).toEqual(['All sports']);
    expect(chosenIn(screen.getByTestId('how-to-play-sport-chips'))).toEqual(['All sports']);
    expect(listContestConfigTemplatesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { active: 'true' } }));
    for (const register of screen.getAllByTestId('how-to-play-register')) {
      expect(register).toHaveAttribute('href', '/');
    }
  });

  it('ends for a signed-out visitor with "Every game day, done right." and the Create your account button, with no sentence', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage();

    const closing = await screen.findByTestId('how-to-play-cta');
    expect(within(closing).getByRole('heading', { level: 2 })).toHaveTextContent('Every game day, done right.');
    expect(within(closing).queryByRole('paragraph')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready to run your pool?')).not.toBeInTheDocument();
    expect(screen.queryByText('Create an account, start a league, and set up your first contest.')).not.toBeInTheDocument();
    expect(within(closing).getByTestId('how-to-play-register')).toHaveTextContent('Create your account');
  });

  it('opens a way to play to its three steps and the sports that offer it, and choosing one of those sports narrows the page to it', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage();

    fireEvent.click(await screen.findByTestId('how-to-play-format-TIERED-toggle'));
    const details = screen.getByTestId('how-to-play-format-TIERED-details');
    expect(within(within(details).getAllByRole('list')[0]).getAllByRole('listitem')).toHaveLength(3);
    // Each sport that offers it is a row naming its leagues, linking to the page narrowed to it.
    expect(within(details).getByTestId('how-to-play-format-TIERED-sport-GOLF')).toHaveTextContent('GolfPGA TOUR · LPGA Tour');
    expect(within(details).getByTestId('how-to-play-format-TIERED-sport-AMERICAN_FOOTBALL')).toBeInTheDocument();

    fireEvent.click(within(details).getByTestId('how-to-play-format-TIERED-sport-GOLF'));
    expect(screen.getByTestId('location')).toHaveTextContent('/how-to-play?sport=golf');
    expect(chosenIn(leaguesColumn())).toEqual(['Golf 1']);
    expect(await waysToPlayHeading()).toHaveTextContent('1 way to play golf');
    expect(screen.queryByTestId('how-to-play-format-SQUARES')).not.toBeInTheDocument();
  });

  it('names a sport\'s first three leagues on its Play it on row and counts the rest, so a sport with many leagues keeps one short line', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [
      ...SPORT_LEAGUES,
      sportLeagueFixture({ id: 'dpw', sport: 'GOLF', name: 'DP World Tour', displayOrder: 30 }),
      sportLeagueFixture({ id: 'liv', sport: 'GOLF', name: 'LIV Golf', displayOrder: 40 }),
    ] } });
    renderPage();

    fireEvent.click(await screen.findByTestId('how-to-play-format-TIERED-toggle'));
    expect(screen.getByTestId('how-to-play-format-TIERED-sport-GOLF')).toHaveTextContent('GolfPGA TOUR · LPGA Tour · DP World Tour + 1 more');
  });

  it('narrows the page to the sport its link names: its count and name in the heading, its line behind the (?), only its ways to play, and its default template inside each', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage('/how-to-play?sport=american-football');

    const formats = await screen.findByTestId('how-to-play-formats');
    expect(await waysToPlayHeading()).toHaveTextContent('2 ways to play american football');
    // The sport's line sits behind the section's (?), never as a sentence in it.
    expect(formats).not.toHaveTextContent('Weekly pick\'em and survivor');
    fireEvent.click(within(formats).getAllByRole('button', { name: 'How this section works' })[0]);
    expect(screen.getByTestId('how-to-play-formats-help-callout')).toHaveTextContent('Weekly pick\'em and survivor');
    expect(screen.getByTestId('how-to-play-format-SQUARES')).toBeInTheDocument();
    // With one sport shown, a tile needs no sport icons.
    expect(screen.queryByTestId('how-to-play-format-SQUARES-sports-icons')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('how-to-play-format-SQUARES-toggle'));
    expect(screen.getByTestId('how-to-play-format-SQUARES-details')).toHaveTextContent('nfl-squares name. nfl-squares description.');

    fireEvent.click(within(leaguesColumn()).getByTestId('how-to-play-leagues-column-all'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/how-to-play$/);
    expect(await waysToPlayHeading()).toHaveTextContent('2 ways to play');
    // A new choice closes the open tile.
    expect(screen.queryByTestId('how-to-play-format-SQUARES-details')).not.toBeInTheDocument();
  });

  it('opens the way to play a contest page\'s link names, at its sport, and scrolls it into view', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage('/how-to-play?sport=golf&format=TIERED');

    const details = await screen.findByTestId('how-to-play-format-TIERED-details');
    expect(within(within(details).getAllByRole('list')[0]).getAllByRole('listitem')).toHaveLength(3);
    expect(await waysToPlayHeading()).toHaveTextContent('1 way to play golf');
    await vi.waitFor(() => expect(scrollIntoView.mock.contexts).toContain(screen.getByTestId('how-to-play-format-TIERED')));
    scrollIntoView.mockRestore();
  });

  it('opens no way to play when the link names a format that is not one', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage('/how-to-play?format=NOT_A_FORMAT');

    await screen.findByTestId('how-to-play-format-TIERED');
    expect(screen.queryByTestId('how-to-play-format-TIERED-details')).not.toBeInTheDocument();
  });

  it('lists every sport in the column with its count of ways to play, the number its heading gives once chosen, the most popular first, each with its first leagues while every sport is shown, and the chosen sport opens to all of its leagues', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage();

    await screen.findByTestId('how-to-play-format-TIERED');
    expect(columnLines()).toEqual(['All sports', 'American football 2', 'NFL', 'College Football Playoff', 'Golf 1', 'PGA TOUR', 'LPGA Tour']);

    fireEvent.click(within(leaguesColumn()).getByTestId('how-to-play-leagues-column-golf'));
    expect(screen.getByTestId('location')).toHaveTextContent('/how-to-play?sport=golf');
    // Another sport closes to its name and count while one is chosen.
    expect(columnLines()).toEqual(['All sports', 'American football 2', 'Golf 1', 'PGA TOUR', 'LPGA Tour']);
  });

  it('caps each sport at four lines with every sport shown, and counts the rest as "+ N more", which chooses that sport', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [
      ...SPORT_LEAGUES,
      sportLeagueFixture({ id: 'dpw', sport: 'GOLF', name: 'DP World Tour', displayOrder: 30 }),
      sportLeagueFixture({ id: 'liv', sport: 'GOLF', name: 'LIV Golf', displayOrder: 40 }),
      sportLeagueFixture({ id: 'kft', sport: 'GOLF', name: 'Korn Ferry Tour', displayOrder: 50 }),
    ] } });
    renderPage();

    await screen.findByTestId('how-to-play-format-TIERED');
    expect(columnLines()).toEqual(['All sports', 'American football 2', 'NFL', 'College Football Playoff', 'Golf 1', 'PGA TOUR', 'LPGA Tour', 'DP World Tour', 'LIV Golf', '+ 1 more']);
    expect(within(leaguesColumn()).getByTestId('how-to-play-leagues-column-golf-more')).toHaveAttribute('href', '/how-to-play?sport=golf');
  });

  it('narrows the page to a league chosen in the column: its name in the heading, only the ways to play it offers, and its own template inside each, kept in the link', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage('/how-to-play?sport=american-football');

    fireEvent.click(await screen.findByTestId('how-to-play-leagues-column-american-football-college-football-playoff'));
    expect(screen.getByTestId('location')).toHaveTextContent('/how-to-play?sport=american-football&league=college-football-playoff');
    expect(chosenIn(leaguesColumn())).toEqual(['College Football Playoff']);
    expect(await waysToPlayHeading()).toHaveTextContent('1 way to play College Football Playoff');
    expect(screen.queryByTestId('how-to-play-format-SQUARES')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('how-to-play-format-TIERED-toggle'));
    expect(screen.getByTestId('how-to-play-format-TIERED-details')).toHaveTextContent('cfp-tiered name. cfp-tiered description.');
  });

  it('opens on the league its link names, shown on a phone as one chip in its sport\'s place whose × goes back to the sport', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage('/how-to-play?sport=american-football&league=nfl');

    expect(await waysToPlayHeading()).toHaveTextContent('2 ways to play NFL');
    const chips = screen.getByTestId('how-to-play-sport-chips');
    expect(within(chips).queryByTestId('how-to-play-sport-chips-american-football')).not.toBeInTheDocument();
    const clear = within(chips).getByRole('link', { name: 'Clear NFL' });
    expect(clear).toHaveTextContent('NFL');

    fireEvent.click(clear);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/how-to-play\?sport=american-football$/);
    expect(chosenIn(screen.getByTestId('how-to-play-sport-chips'))).toEqual(['American football']);
    expect(await waysToPlayHeading()).toHaveTextContent('2 ways to play american football');
  });

  it('shows every sport when the link names a sport with no contest types', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage('/how-to-play?sport=curling');

    expect(await screen.findByTestId('how-to-play-format-SQUARES')).toBeInTheDocument();
    expect(chosenIn(leaguesColumn())).toEqual(['All sports']);
    expect(await waysToPlayHeading()).toHaveTextContent('2 ways to play');
  });

  it('lists every sport\'s leagues as chips in the "Every league you can run" card, each linking to that league and scrolling back up to the ways to play', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    renderPage();

    const card = await screen.findByTestId('how-to-play-every-league');
    expect(within(card).getByRole('heading', { name: 'Every league you can run' })).toBeInTheDocument();
    expect(within(card).getByRole('navigation', { name: 'Golf leagues' })).toHaveTextContent('PGA TOURLPGA Tour');
    const lpga = within(card).getByRole('link', { name: 'LPGA Tour' });
    expect(lpga).toHaveAttribute('href', '/how-to-play?sport=golf&league=lpga-tour');

    fireEvent.click(lpga);
    expect(screen.getByTestId('location')).toHaveTextContent('/how-to-play?sport=golf&league=lpga-tour');
    expect(scrollIntoView.mock.contexts.map((element) => (element as HTMLElement).id)).toContain('ways-to-play');
    expect(within(screen.getByTestId('how-to-play-sport-chips')).getByRole('link', { name: 'Clear LPGA Tour' })).toBeInTheDocument();
    scrollIntoView.mockRestore();
  });

  it('sends a signed-in member to their leagues instead of to registration', async () => {
    authState.isAuthenticated = true;
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [template('golf-tiered-pick-6', {})] } });
    renderPage();

    await screen.findByTestId('how-to-play-format-TIERED');
    expect(screen.getByTestId('how-to-play-leagues')).toHaveAttribute('href', '/welcome');
    expect(screen.queryByTestId('how-to-play-register')).not.toBeInTheDocument();
    expect(screen.queryByTestId('how-to-play-cta')).not.toBeInTheDocument();
  });

  describe('a championship stat pool league', () => {
    // Baseball's sport-wide bracket, the MLB postseason's own survivor, and the World Series' stat pool setups.
    const BASEBALL = [
      template('mlb-bracket', { sport: 'BASEBALL', selectionType: 'BRACKET', contestFormat: 'BRACKET', configuration: { selectionType: 'BRACKET', startsAtRound: 1, maxEntriesPerSquad: 1 } }),
      template('world-series-tiered', { sport: 'BASEBALL', sportLeagueId: 'world-series' }),
    ];
    const BASEBALL_LEAGUES = [
      sportLeagueFixture({ id: 'mlb', sport: 'BASEBALL', name: 'MLB Postseason', displayOrder: 10 }),
      sportLeagueFixture({ id: 'world-series', sport: 'BASEBALL', name: 'World Series', displayOrder: 20, participantType: 'INDIVIDUAL', scoringFamily: 'COMPOSITE' }),
    ];

    it('shows the Clutch Card as one tile after the other ways to play, opening to its steps, Box Score as a stat line row and a link to the Clutch Card page', async () => {
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: BASEBALL } });
      listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: BASEBALL_LEAGUES } });
      renderPage('/how-to-play?sport=baseball&league=world-series');

      const tile = await screen.findByTestId('how-to-play-clutch-card');
      expect(screen.getByTestId('how-to-play-format-TIERED').compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(tile).toHaveTextContent('Clutch Card');
      expect(screen.queryByTestId('how-to-play-clutch-card-details')).not.toBeInTheDocument();
      expect(screen.queryByTestId('how-to-play-format-BRACKET')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('how-to-play-clutch-card-toggle'));
      const details = screen.getByTestId('how-to-play-clutch-card-details');
      expect(within(details).getAllByRole('listitem')).toHaveLength(4);
      expect(within(details).getByTestId('how-to-play-clutch-card-stat-BASEBALL')).toHaveTextContent('Box ScoreBaseball');
      expect(within(details).getByTestId('how-to-play-clutch-card-more')).toHaveAttribute('href', '/play/clutch-card');
      expect(details).not.toHaveTextContent('total bases');
    });

    it('shows the Clutch Card with every sport shown, and opening another way to play closes it', async () => {
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: BASEBALL } });
      listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: BASEBALL_LEAGUES } });
      renderPage();

      fireEvent.click(await screen.findByTestId('how-to-play-clutch-card-toggle'));
      expect(screen.getByTestId('how-to-play-clutch-card-details')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('how-to-play-format-BRACKET-toggle'));
      expect(screen.queryByTestId('how-to-play-clutch-card-details')).not.toBeInTheDocument();
      expect(screen.getByTestId('how-to-play-format-BRACKET-details')).toBeInTheDocument();
    });

    it('shows no Clutch Card on a league that plays its sport\'s own way', async () => {
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: BASEBALL } });
      listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: BASEBALL_LEAGUES } });
      renderPage('/how-to-play?sport=baseball&league=mlb-postseason');

      expect(await screen.findByTestId('how-to-play-format-BRACKET')).toBeInTheDocument();
      expect(screen.queryByTestId('how-to-play-clutch-card')).not.toBeInTheDocument();
    });

    it('opens Create contest on the stat pool league\'s Clutch Card setup for a commissioner', async () => {
      signInTo([buildLeague({ id: 'office', leagueCode: 'OFFICE', name: 'Office pool' })]);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: BASEBALL } });
      listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: BASEBALL_LEAGUES } });
      renderPage('/how-to-play?sport=baseball');

      fireEvent.click(await screen.findByTestId('how-to-play-clutch-card-toggle'));
      expect(await screen.findByTestId('how-to-play-clutch-card-create'))
        .toHaveAttribute('href', '/league/OFFICE/admin/contests/new?template=id-world-series-tiered');
    });
  });

  describe('Create contest inside a way to play', () => {
    it('opens Create contest in the one league a commissioner runs, on the chosen league\'s template', async () => {
      signInTo([buildLeague({ id: 'office', leagueCode: 'OFFICE', name: 'Office pool' })]);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
      renderPage('/how-to-play?sport=american-football&league=college-football-playoff');

      fireEvent.click(await screen.findByTestId('how-to-play-format-TIERED-toggle'));
      expect(await screen.findByTestId('how-to-play-format-TIERED-create'))
        .toHaveAttribute('href', '/league/OFFICE/admin/contests/new?template=id-cfp-tiered');
    });

    it('starts on the most popular sport\'s first league\'s template while every sport is shown', async () => {
      signInTo([buildLeague({ id: 'office', leagueCode: 'OFFICE', name: 'Office pool' })]);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
      renderPage();

      fireEvent.click(await screen.findByTestId('how-to-play-format-TIERED-toggle'));
      expect(await screen.findByTestId('how-to-play-format-TIERED-create'))
        .toHaveAttribute('href', '/league/OFFICE/admin/contests/new?template=id-nfl-tiered');
    });

    it('asks a commissioner of several active leagues which one, leaving out an inactive league', async () => {
      signInTo([
        buildLeague({ id: 'office', leagueCode: 'OFFICE', name: 'Office pool' }),
        buildLeague({ id: 'family', leagueCode: 'FAMILY', name: 'Family pool' }),
        buildLeague({ id: 'old', leagueCode: 'OLD', name: 'Old pool', isActive: false }),
      ]);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
      renderPage('/how-to-play?sport=american-football&league=nfl');

      fireEvent.click(await screen.findByTestId('how-to-play-format-SQUARES-toggle'));
      const create = await screen.findByTestId('how-to-play-format-SQUARES-create');
      expect(create).toHaveTextContent('Create contest in');
      expect(within(create).getByTestId('how-to-play-format-SQUARES-create-OFFICE')).toHaveAttribute('href', '/league/OFFICE/admin/contests/new?template=id-nfl-squares');
      expect(within(create).getByTestId('how-to-play-format-SQUARES-create-FAMILY')).toHaveAttribute('href', '/league/FAMILY/admin/contests/new?template=id-nfl-squares');
      expect(within(create).queryByTestId('how-to-play-format-SQUARES-create-OLD')).not.toBeInTheDocument();
    });

    it('offers no Create contest to a member who runs no league, nor to a signed-out visitor', async () => {
      signInTo([buildLeague({ id: 'office', leagueCode: 'OFFICE', name: 'Office pool' })], LeagueRole.MEMBER);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
      renderPage('/how-to-play?sport=golf');

      fireEvent.click(await screen.findByTestId('how-to-play-format-TIERED-toggle'));
      await vi.waitFor(() => expect(listLeaguesMock).toHaveBeenCalled());
      expect(screen.getByTestId('how-to-play-format-TIERED-details')).toBeInTheDocument();
      expect(screen.queryByTestId('how-to-play-format-TIERED-create')).not.toBeInTheDocument();
    });

    it('never reads leagues for a signed-out visitor', async () => {
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
      renderPage();

      fireEvent.click(await screen.findByTestId('how-to-play-format-TIERED-toggle'));
      expect(screen.queryByTestId('how-to-play-format-TIERED-create')).not.toBeInTheDocument();
      expect(listLeaguesMock).not.toHaveBeenCalled();
    });
  });

  describe('a season league with playoff rounds', () => {
    // The NHL's own tiered and hockey's survivor, and the Stanley Cup Final's stat pool tiered.
    const HOCKEY = [
      template('nhl-tiered', { sport: 'HOCKEY', sportLeagueId: 'nhl' }),
      template('hockey-survivor', { sport: 'HOCKEY', selectionType: 'SURVIVOR', contestFormat: 'SURVIVOR', configuration: { selectionType: 'SURVIVOR', maxEntriesPerSquad: 1 } }),
      template('stanley-cup-final-tiered', { sport: 'HOCKEY', sportLeagueId: 'stanley-cup-final' }),
    ];
    // Display order puts the rounds after every season league; the parent link still lists them under the NHL.
    const HOCKEY_LEAGUES = [
      sportLeagueFixture({ id: 'nhl', sport: 'HOCKEY', name: 'NHL', displayOrder: 10 }),
      sportLeagueFixture({ id: 'pwhl', sport: 'HOCKEY', name: 'PWHL', displayOrder: 20 }),
      sportLeagueFixture({ id: 'stanley-cup-final', sport: 'HOCKEY', name: 'Stanley Cup Final', displayOrder: 50, participantType: 'INDIVIDUAL', scoringFamily: 'COMPOSITE', parentSportLeagueId: 'nhl' }),
    ];

    beforeEach(() => {
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: HOCKEY } });
      listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: HOCKEY_LEAGUES } });
    });

    it('lists each round under the league its parent link names, after the league\'s regular season, and not after the other leagues', async () => {
      renderPage('/how-to-play?sport=hockey');

      expect(await waysToPlayHeading()).toHaveTextContent('3 ways to play hockey');
      expect(columnLines()).toEqual(['All sports', 'Hockey 3', 'NHL', 'Regular season', 'Stanley Cup Final', 'PWHL']);
      expect(within(leaguesColumn()).getByRole('link', { name: 'Stanley Cup Final' })).toHaveAttribute('href', '/how-to-play?sport=hockey&league=nhl&part=stanley-cup-final');
      // On a phone the card lists the round right after its league.
      expect(within(screen.getByTestId('how-to-play-every-league')).getByRole('navigation', { name: 'Hockey leagues' })).toHaveTextContent('NHLStanley Cup FinalPWHL');
    });

    it('shows a league with its rounds\' ways to play too: the Clutch Card on the NHL', async () => {
      renderPage('/how-to-play?sport=hockey&league=nhl');

      expect(await waysToPlayHeading()).toHaveTextContent('3 ways to play NHL');
      expect(chosenIn(leaguesColumn())).toEqual(['NHL']);
      expect(screen.getByTestId('how-to-play-format-SURVIVOR')).toBeInTheDocument();
      expect(screen.getByTestId('how-to-play-clutch-card')).toBeInTheDocument();
      // The league's own template leads its tile.
      fireEvent.click(screen.getByTestId('how-to-play-format-TIERED-toggle'));
      expect(screen.getByTestId('how-to-play-format-TIERED-details')).toHaveTextContent('nhl-tiered name.');
    });

    it('narrows to the regular season alone, with no Clutch Card', async () => {
      renderPage('/how-to-play?sport=hockey&league=nhl&part=nhl');

      expect(await waysToPlayHeading()).toHaveTextContent('2 ways to play the NHL regular season');
      expect(chosenIn(leaguesColumn())).toEqual(['Regular season']);
      expect(screen.queryByTestId('how-to-play-clutch-card')).not.toBeInTheDocument();
      expect(within(screen.getByTestId('how-to-play-sport-chips')).getByRole('link', { name: 'Clear NHL · Regular season' })).toHaveAttribute('href', '/how-to-play?sport=hockey');
    });

    it('narrows to one round, named in the heading and as one clearable chip on a phone', async () => {
      renderPage('/how-to-play?sport=hockey&league=nhl&part=stanley-cup-final');

      expect(await waysToPlayHeading()).toHaveTextContent('2 ways to play the Stanley Cup Final');
      expect(chosenIn(leaguesColumn())).toEqual(['Stanley Cup Final']);
      expect(screen.queryByTestId('how-to-play-format-SURVIVOR')).not.toBeInTheDocument();
      expect(screen.getByTestId('how-to-play-clutch-card')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('how-to-play-format-TIERED-toggle'));
      expect(screen.getByTestId('how-to-play-format-TIERED-details')).toHaveTextContent('stanley-cup-final-tiered name.');

      fireEvent.click(within(screen.getByTestId('how-to-play-sport-chips')).getByRole('link', { name: 'Clear NHL · Stanley Cup Final' }));
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/how-to-play\?sport=hockey$/);
    });

    it('drops a part the league does not have, back to the whole league', async () => {
      renderPage('/how-to-play?sport=hockey&league=nhl&part=frozen-four');

      expect(await waysToPlayHeading()).toHaveTextContent('3 ways to play NHL');
    });

    it('gives the Clutch Card its new line on the tile, and how it plays once opened', async () => {
      renderPage('/how-to-play?sport=hockey');

      const tile = await screen.findByTestId('how-to-play-clutch-card');
      expect(tile).toHaveTextContent('Who will come in clutch? Pick your stars.');
      expect(tile).not.toHaveTextContent('Every game is a round');
      fireEvent.click(screen.getByTestId('how-to-play-clutch-card-toggle'));
      expect(screen.getByTestId('how-to-play-clutch-card-details')).toHaveTextContent('Every game is a round, and each star scores one stat in it.');
    });
  });

  describe('a tile\'s sport icons', () => {
    let restoreLayout: () => void = () => undefined;
    afterEach(() => restoreLayout());

    /** Every element reads `width` px wide, as a tile's icon row would on a phone. */
    function layOutRowsAt(width: number) {
      const original = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
      restoreLayout = () => {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
        if (original) Object.defineProperty(Element.prototype, 'clientWidth', original);
      };
    }

    it('keeps the icons to one line and counts the rest as "+N", naming every sport for screen readers', async () => {
      // Room for two icons at 24px each, after the 28px kept for "+N".
      layOutRowsAt(80);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [
        template('golf-tiered', {}),
        template('nfl-tiered', { sport: 'AMERICAN_FOOTBALL', sportLeagueId: 'nfl' }),
        template('nba-tiered', { sport: 'BASKETBALL' }),
        template('nhl-tiered', { sport: 'HOCKEY' }),
      ] } });
      renderPage();

      const icons = await screen.findByTestId('how-to-play-format-TIERED-sports-icons');
      await vi.waitFor(() => expect(within(icons).getByTestId('how-to-play-format-TIERED-sports-icons-more')).toHaveTextContent('+2'));
      expect(icons).toHaveAccessibleName('On American football, Basketball, Hockey, Golf');
    });

    it('shows every icon, with no "+N", when they all fit', async () => {
      layOutRowsAt(300);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
      renderPage();

      const icons = await screen.findByTestId('how-to-play-format-TIERED-sports-icons');
      expect(within(icons).queryByTestId('how-to-play-format-TIERED-sports-icons-more')).not.toBeInTheDocument();
      expect(icons).toHaveAccessibleName('On American football, Golf');
    });
  });

  describe('"+ Create" on a closed tile', () => {
    it('opens Create contest on the tile\'s template in the one league a commissioner runs, named for its type, beside the tile\'s own button', async () => {
      signInTo([buildLeague({ id: 'office', leagueCode: 'OFFICE', name: 'Office pool' })]);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
      renderPage('/how-to-play?sport=american-football&league=nfl');

      const create = await screen.findByRole('link', { name: 'Create a Squares contest' });
      expect(create).toHaveTextContent('+ Create');
      expect(create).toHaveAttribute('href', '/league/OFFICE/admin/contests/new?template=id-nfl-squares');
      // A sibling of the tile's toggle, never inside it.
      expect(screen.getByTestId('how-to-play-format-SQUARES-toggle')).not.toContainElement(create);
      expect(screen.getByTestId('how-to-play-format-SQUARES-actions')).toContainElement(create);

      fireEvent.click(screen.getByTestId('how-to-play-format-SQUARES-toggle'));
      expect(screen.queryByRole('link', { name: 'Create a Squares contest' })).not.toBeInTheDocument();
    });

    it('asks which league from a menu when a commissioner runs several', async () => {
      signInTo([
        buildLeague({ id: 'office', leagueCode: 'OFFICE', name: 'Office pool' }),
        buildLeague({ id: 'family', leagueCode: 'FAMILY', name: 'Family pool' }),
      ]);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
      renderPage('/how-to-play?sport=american-football&league=nfl');

      const create = await screen.findByRole('button', { name: 'Create a Tiered contest' });
      fireEvent.pointerDown(create, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      const menu = await screen.findByTestId('how-to-play-format-TIERED-quick-create-menu');
      expect(menu).toHaveTextContent('Create contest in');
      expect(within(menu).getByTestId('how-to-play-format-TIERED-quick-create-OFFICE')).toHaveAttribute('href', '/league/OFFICE/admin/contests/new?template=id-nfl-tiered');
      expect(within(menu).getByTestId('how-to-play-format-TIERED-quick-create-FAMILY')).toHaveAttribute('href', '/league/FAMILY/admin/contests/new?template=id-nfl-tiered');
    });

    it('shows a member who runs no league no "+ Create"', async () => {
      signInTo([buildLeague({ id: 'office', leagueCode: 'OFFICE', name: 'Office pool' })], LeagueRole.MEMBER);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
      renderPage();

      await screen.findByTestId('how-to-play-format-TIERED');
      await vi.waitFor(() => expect(listLeaguesMock).toHaveBeenCalled());
      expect(screen.queryByTestId('how-to-play-format-TIERED-actions')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^Create a / })).not.toBeInTheDocument();
    });
  });

  it('says the contest types could not be loaded when the template list fails', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'boom' } }, response: { status: 500 } });
    renderPage();

    expect(await screen.findByText("We couldn't load the contest types.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says the contest types could not be loaded when the sport league list fails', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_AND_FOOTBALL } });
    listSportLeaguesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'boom' } }, response: { status: 500 } });
    renderPage();

    expect(await screen.findByText("We couldn't load the contest types.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
