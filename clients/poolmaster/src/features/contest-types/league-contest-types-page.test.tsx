import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { SPORT_BLURBS } from './sport-blurbs';
import { LeagueContestTypesPage } from './league-contest-types-page';

const { getLeagueByCodeMock, listContestConfigTemplatesMock, listEventsMock, listSportLeaguesMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    getLeagueByCodeMock: vi.fn(),
    listContestConfigTemplatesMock: vi.fn(),
    listEventsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getLeagueByCode: getLeagueByCodeMock,
  listContestConfigTemplates: listContestConfigTemplatesMock,
  listEvents: listEventsMock,
  listSportLeagues: listSportLeaguesMock,
});

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, isRootAdmin: false, user: { id: 'user-1' }, clearSession: vi.fn() }),
}));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const NFL = '80300000-0000-4000-8000-000000000001';
const NBA = '80300000-0000-4000-8000-000000000002';

function template(templateKey: string, overrides: Record<string, unknown>) {
  return {
    id: `80300000-0000-4000-8000-0000000001${String(templateKey.length).padStart(2, '0')}`,
    sport: 'AMERICAN_FOOTBALL',
    sportLeagueId: NFL,
    eventType: 'KNOCKOUT',
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

const TEMPLATES = [
  template('nfl-tiered-doubling', { id: 'tpl-nfl-tiered' }),
  template('nfl-tiered-doubling-upset-bonus', { id: 'tpl-nfl-tiered-upset', isDefault: false, sortOrder: 2 }),
  template('nfl-pick-em-straight-up', { id: 'tpl-nfl-pick-em', eventType: 'WEEK', contestFormat: 'PREDICTION', selectionType: 'PICK_EM', configuration: { selectionType: 'PICK_EM', mode: 'STRAIGHT_UP', againstTheSpread: false, maxEntriesPerSquad: 1 } }),
  template('nba-tiered-doubling', { id: 'tpl-nba-tiered', sport: 'BASKETBALL', sportLeagueId: NBA }),
];

/** An NFL week coming up, which takes the NFL's week templates; no NFL playoffs and no NBA events yet. */
const NFL_WEEK = {
  id: 'nfl-week-1',
  sport: 'AMERICAN_FOOTBALL',
  name: 'NFL Week 1',
  status: 'SCHEDULED',
  startDate: '2099-09-10T17:00:00.000Z',
  participantCount: 32,
  readinessStatus: 'CONTEST_ELIGIBLE',
  readinessReasons: [],
  contestEligible: true,
  tierCount: 0,
  rounds: 1,
  sportLeagueId: NFL,
};

function primeMocks(role: 'COMMISSIONER' | 'MEMBER', { isActive = true }: { isActive?: boolean } = {}) {
  getLeagueByCodeMock.mockResolvedValue({
    data: {
      league: { id: 'league-1', leagueCode: 'BIGDAWGS', name: 'Big Dawgs', isActive, iconKey: 'TROPHY', memberCount: 2, activeContestCount: 0, createdAt: '2026-04-15T00:00:00.000Z' },
      membership: { id: 'membership-1', leagueId: 'league-1', userId: 'user-1', role, status: 'ACTIVE', joinedAt: '2026-04-15T00:00:00.000Z', createdAt: '2026-04-15T00:00:00.000Z', updatedAt: '2026-04-15T00:00:00.000Z' },
      squadMembership: null,
    },
  });
  listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: TEMPLATES } });
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [{ id: NFL, name: 'NFL', sport: 'AMERICAN_FOOTBALL', participantType: null, scoringFamily: null, isActive: true }, { id: NBA, name: 'NBA', sport: 'BASKETBALL', participantType: null, scoringFamily: null, isActive: true }] } });
  listEventsMock.mockImplementation((options: { query?: { sport?: string } }) => Promise.resolve({
    data: { events: options.query?.sport === 'AMERICAN_FOOTBALL' ? [NFL_WEEK] : [] },
  }));
}

function renderPage(path = '/league/BIGDAWGS/admin/contest-types') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<LeagueContestTypesPage />} path="/league/:leagueCode/admin/contest-types" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  for (const mock of [getLeagueByCodeMock, listContestConfigTemplatesMock, listEventsMock, listSportLeaguesMock]) {
    mock.mockReset();
  }
});

describe('League › Contest types', () => {
  it('shows every contest type by sport and sport league, each tile with its default\'s name and description and its variations', async () => {
    primeMocks('MEMBER');
    renderPage();

    const football = await screen.findByTestId('contest-types-sport-AMERICAN_FOOTBALL');
    expect(within(football).getByText('American football')).toBeInTheDocument();
    expect(within(football).getByText('NFL')).toBeInTheDocument();
    const tiered = within(football).getByTestId('contest-type-nfl-nfl-tiered-doubling');
    expect(tiered).toHaveTextContent('nfl-tiered-doubling name');
    expect(tiered).toHaveTextContent('nfl-tiered-doubling description.');
    expect(within(tiered).getByTestId('contest-type-nfl-nfl-tiered-doubling-variations')).toHaveTextContent('nfl-tiered-doubling-upset-bonus name');
    expect(screen.getByTestId('contest-types-sport-BASKETBALL')).toHaveTextContent('NBA');
  });

  describe('a sport whose leagues share its every-event contest types', () => {
    const PGA = '80300000-0000-4000-8000-000000000011';
    const LPGA = '80300000-0000-4000-8000-000000000012';
    const THOROUGHBRED = '80300000-0000-4000-8000-000000000013';
    const golf = (templateKey: string, overrides: Record<string, unknown>) => template(templateKey, { sport: 'GOLF', sportLeagueId: null, eventType: null, ...overrides });
    const GOLF_TEMPLATES = [
      golf('golf-tiered-pick-6', { id: 'tpl-golf-tiered' }),
      golf('golf-tiered-pick-12', { id: 'tpl-golf-tiered-12', isDefault: false, sortOrder: 2 }),
      golf('golf-budget-pick-6-best-4', { id: 'tpl-golf-budget', selectionType: 'BUDGET_PICK', configuration: { selectionType: 'BUDGET_PICK', picks: 6, countedScores: 4, maxEntriesPerSquad: 1 } }),
      golf('golf-quick-pick-6', { id: 'tpl-golf-quick', selectionType: 'RANDOM_DRAW', configuration: { selectionType: 'RANDOM_DRAW', picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 1 } }),
      golf('pga-tour-majors-tiered', { id: 'tpl-pga-majors', sportLeagueId: PGA, isDefault: false, sortOrder: 10 }),
      template('horse-racing-tiered', { id: 'tpl-horse-tiered', sport: 'HORSE_RACING', sportLeagueId: null, eventType: null }),
    ];
    const GOLF_LEAGUES = [
      { id: PGA, name: 'PGA TOUR', sport: 'GOLF', participantType: null, scoringFamily: null, isActive: true, displayOrder: 10, parentSportLeagueId: null },
      { id: LPGA, name: 'LPGA Tour', sport: 'GOLF', participantType: null, scoringFamily: null, isActive: true, displayOrder: 20, parentSportLeagueId: null },
      { id: THOROUGHBRED, name: 'US Thoroughbred', sport: 'HORSE_RACING', participantType: null, scoringFamily: null, isActive: true, displayOrder: 10, parentSportLeagueId: null },
    ];
    /** A PGA TOUR tournament coming up; nothing on the LPGA Tour yet. */
    const PGA_EVENT = { ...NFL_WEEK, id: 'pga-event', sport: 'GOLF', name: 'The Players', participantCount: 144, rounds: 4, sportLeagueId: PGA };

    function primeGolf(role: 'COMMISSIONER' | 'MEMBER') {
      primeMocks(role);
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: GOLF_TEMPLATES } });
      listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: GOLF_LEAGUES } });
      listEventsMock.mockImplementation((options: { query?: { sport?: string } }) => Promise.resolve({
        data: { events: options.query?.sport === 'GOLF' ? [PGA_EVENT] : [] },
      }));
    }

    it('shows a chosen league every contest type it can run, its own leading its format and its sport\'s every-event types beside them, with no "Every tournament" section', async () => {
      primeGolf('MEMBER');
      renderPage('/league/BIGDAWGS/admin/contest-types?sport=golf&league=pga-tour');

      const golfSection = await screen.findByTestId('contest-types-sport-GOLF');
      expect(golfSection).not.toHaveTextContent('Every tournament');
      expect(golfSection).not.toHaveTextContent('LPGA Tour');
      expect(within(golfSection).getByTestId('contest-type-pga-tour-pga-tour-majors-tiered-variations')).toHaveTextContent('golf-tiered-pick-6 name');
      expect(within(golfSection).getByTestId('contest-type-pga-tour-golf-budget-pick-6-best-4')).toBeInTheDocument();
      expect(within(golfSection).getByTestId('contest-type-pga-tour-golf-quick-pick-6')).toBeInTheDocument();
    });

    it('shows a chosen sport one section per league, each with all its contest types, and counts the contest types listed beside each sport', async () => {
      primeGolf('MEMBER');
      renderPage('/league/BIGDAWGS/admin/contest-types?sport=golf');

      const golfSection = await screen.findByTestId('contest-types-sport-GOLF');
      expect(within(golfSection).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent).filter((name) => name === 'PGA TOUR' || name === 'LPGA Tour')).toEqual(['PGA TOUR', 'LPGA Tour']);
      expect(within(golfSection).getByTestId('contest-type-pga-tour-pga-tour-majors-tiered')).toBeInTheDocument();
      expect(within(golfSection).getByTestId('contest-type-lpga-tour-golf-tiered-pick-6')).toBeInTheDocument();
      expect(within(golfSection).getByTestId('contest-type-lpga-tour-golf-quick-pick-6')).toBeInTheDocument();
      const column = screen.getByRole('navigation', { name: 'Sports and leagues' });
      // Golf: three types under each of its two tours; horse racing: one under US Thoroughbred.
      expect(within(column).getAllByRole('link').map((link) => link.textContent)).toEqual(['All sports', 'Golf 6', 'PGA TOUR', 'LPGA Tour', 'Horse racing 1']);
    });

    it('gives a league with only its sport\'s every-event contest types a section, as US Thoroughbred has', async () => {
      primeGolf('MEMBER');
      renderPage('/league/BIGDAWGS/admin/contest-types?sport=horse-racing');

      const racing = await screen.findByTestId('contest-types-sport-HORSE_RACING');
      expect(racing).toHaveTextContent('US Thoroughbred');
      expect(within(racing).getByTestId('contest-type-us-thoroughbred-horse-racing-tiered')).toBeInTheDocument();
    });

    it('starts Create contest from a league\'s section with that league chosen, and says a type has no event when only another league has one coming up', async () => {
      primeGolf('COMMISSIONER');
      renderPage('/league/BIGDAWGS/admin/contest-types?sport=golf');

      expect(await screen.findByTestId('contest-type-pga-tour-create-golf-budget-pick-6-best-4'))
        .toHaveAttribute('href', `/league/BIGDAWGS/admin/contests/new?template=tpl-golf-budget&sportLeague=${PGA}`);
      expect(await screen.findByTestId('contest-type-lpga-tour-no-events-golf-budget-pick-6-best-4')).toHaveTextContent('No upcoming events yet');
    });
  });

  it('narrows the page with the same sport and league column as How to Play: a sport shows only its section, a league only its group, and All sports every one', async () => {
    primeMocks('MEMBER');
    renderPage('/league/BIGDAWGS/admin/contest-types?sport=basketball');

    expect(await screen.findByTestId('contest-types-sport-BASKETBALL')).toHaveTextContent('NBA');
    expect(screen.queryByTestId('contest-types-sport-AMERICAN_FOOTBALL')).not.toBeInTheDocument();
    const column = screen.getByRole('navigation', { name: 'Sports and leagues' });
    expect(within(column).getAllByRole('link').map((link) => link.textContent)).toEqual(['All sports', 'Basketball 1', 'NBA', 'American football 2']);
    expect(within(column).getByRole('link', { current: 'page' })).toHaveTextContent('Basketball');

    fireEvent.click(screen.getByTestId('contest-types-leagues-column-american-football'));
    fireEvent.click(within(column).getByRole('link', { name: 'NFL' }));
    expect(screen.getByTestId('contest-types-sport-AMERICAN_FOOTBALL')).toHaveTextContent('nfl-tiered-doubling name');
    expect(screen.queryByTestId('contest-types-sport-BASKETBALL')).not.toBeInTheDocument();

    fireEvent.click(within(column).getByRole('link', { name: 'All sports' }));
    expect(screen.getByTestId('contest-types-sport-AMERICAN_FOOTBALL')).toBeInTheDocument();
    expect(screen.getByTestId('contest-types-sport-BASKETBALL')).toBeInTheDocument();
  });

  it('switches sport on a phone with the same chip row and "Every league you can run" card as How to Play', async () => {
    primeMocks('MEMBER');
    renderPage('/league/BIGDAWGS/admin/contest-types?sport=american-football&league=nfl');

    expect(await screen.findByTestId('contest-types-sport-AMERICAN_FOOTBALL')).toHaveTextContent('nfl-tiered-doubling name');
    const chips = screen.getByRole('navigation', { name: 'Sport' });
    fireEvent.click(within(chips).getByRole('link', { name: 'Clear NFL' }));
    expect(within(screen.getByRole('navigation', { name: 'Sport' })).getByRole('link', { current: 'page' })).toHaveTextContent('American football');

    fireEvent.click(within(screen.getByTestId('contest-types-every-league')).getByRole('link', { name: 'NBA' }));
    expect(screen.getByTestId('contest-types-sport-BASKETBALL')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-types-sport-AMERICAN_FOOTBALL')).not.toBeInTheDocument();
  });

  it('lists a playoff round under its season league, and choosing the league shows the round\'s group with its own', async () => {
    primeMocks('MEMBER');
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [
      ...TEMPLATES,
      template('super-bowl-tiered', { id: 'tpl-super-bowl', sportLeagueId: 'super-bowl' }),
    ] } });
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [
      { id: NFL, name: 'NFL', sport: 'AMERICAN_FOOTBALL', participantType: null, scoringFamily: null, isActive: true, parentSportLeagueId: null },
      { id: 'super-bowl', name: 'Super Bowl', sport: 'AMERICAN_FOOTBALL', participantType: 'INDIVIDUAL', scoringFamily: 'COMPOSITE', isActive: true, parentSportLeagueId: NFL },
      { id: NBA, name: 'NBA', sport: 'BASKETBALL', participantType: null, scoringFamily: null, isActive: true, parentSportLeagueId: null },
    ] } });
    renderPage('/league/BIGDAWGS/admin/contest-types?sport=american-football&league=nfl');

    const football = await screen.findByTestId('contest-types-sport-AMERICAN_FOOTBALL');
    expect(football).toHaveTextContent('super-bowl-tiered name');
    expect(football).toHaveTextContent('nfl-tiered-doubling name');
    const column = screen.getByRole('navigation', { name: 'Sports and leagues' });
    expect(within(column).getAllByRole('link').map((link) => link.textContent)).toEqual(['All sports', 'Basketball 1', 'American football 3', 'NFL', 'Regular season', 'Super Bowl']);

    fireEvent.click(within(column).getByRole('link', { name: 'Super Bowl' }));
    expect(screen.getByTestId('contest-types-sport-AMERICAN_FOOTBALL')).toHaveTextContent('super-bowl-tiered name');
    expect(screen.getByTestId('contest-types-sport-AMERICAN_FOOTBALL')).not.toHaveTextContent('nfl-tiered-doubling name');
  });

  it('keeps each sport\'s line behind its section\'s (?), and shows no inactive notice on an active league', async () => {
    primeMocks('COMMISSIONER');
    renderPage();

    const football = await screen.findByTestId('contest-types-sport-AMERICAN_FOOTBALL');
    expect(football).not.toHaveTextContent(SPORT_BLURBS.AMERICAN_FOOTBALL);
    fireEvent.click(within(football).getByRole('button', { name: 'How this section works' }));
    expect(screen.getByTestId('contest-types-sport-AMERICAN_FOOTBALL-help-callout')).toHaveTextContent(SPORT_BLURBS.AMERICAN_FOOTBALL);
    expect(screen.queryByTestId('contest-types-inactive')).not.toBeInTheDocument();
  });

  it('keeps a variation\'s description behind its (?) help tip, shown on a tap, not in a title tooltip', async () => {
    primeMocks('MEMBER');
    renderPage();

    const variations = await screen.findByTestId('contest-type-nfl-nfl-tiered-doubling-variations');
    expect(variations).not.toHaveTextContent('nfl-tiered-doubling-upset-bonus description.');
    fireEvent.click(within(variations).getByRole('button', { name: 'How nfl-tiered-doubling-upset-bonus name works' }));
    expect(screen.getByTestId('contest-type-nfl-nfl-tiered-doubling-upset-bonus-help-callout')).toHaveTextContent('nfl-tiered-doubling-upset-bonus description.');
  });

  it('says a stat pool league\'s group is a Clutch Card and how its players score, and nothing of the kind on its sport\'s own league', async () => {
    primeMocks('MEMBER');
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [...TEMPLATES, template('nba-finals-tiered', { id: 'tpl-nba-finals', sport: 'BASKETBALL', sportLeagueId: 'nba-finals', eventType: null })] } });
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [
      { id: NBA, name: 'NBA', sport: 'BASKETBALL', participantType: null, scoringFamily: null, isActive: true },
      { id: 'nba-finals', name: 'NBA Finals', sport: 'BASKETBALL', participantType: 'INDIVIDUAL', scoringFamily: 'COMPOSITE', isActive: true },
    ] } });
    renderPage();

    expect(await screen.findByTestId('contest-types-stat-pool-nba-finals'))
      .toHaveTextContent('Clutch Card. Each star scores Triple Threat: points + rebounds + assists, each game.');
    expect(screen.queryByTestId(`contest-types-stat-pool-${NBA}`)).not.toBeInTheDocument();
  });

  it('gives the commissioner of an inactive league the menu without any create links, with a notice that it can run them once active again', async () => {
    primeMocks('COMMISSIONER', { isActive: false });
    renderPage();

    await screen.findByTestId('contest-type-nfl-nfl-tiered-doubling');
    expect(screen.getByTestId('contest-types-inactive')).toHaveTextContent('once the league is active again');
    expect(screen.queryByText('Create this contest')).not.toBeInTheDocument();
    expect(screen.queryByText('No upcoming events yet')).not.toBeInTheDocument();
    expect(listEventsMock).not.toHaveBeenCalled();
  });

  it('gives a commissioner a create link on each type with an event coming up, opening Create contest on that template, and says when a type has none', async () => {
    primeMocks('COMMISSIONER');
    renderPage();

    const pickEm = await screen.findByTestId('contest-type-nfl-create-nfl-pick-em-straight-up');
    expect(pickEm).toHaveAttribute('href', `/league/BIGDAWGS/admin/contests/new?template=tpl-nfl-pick-em&sportLeague=${NFL}`);
    expect(await screen.findByTestId('contest-type-nfl-no-events-nfl-tiered-doubling')).toHaveTextContent('No upcoming events yet');
    expect(screen.getByTestId('contest-type-nba-no-events-nba-tiered-doubling')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-type-nfl-create-nfl-tiered-doubling-upset-bonus')).not.toBeInTheDocument();
  });

  describe('a commissioner\'s bracket links, which open only where the event can start that bracket', () => {
    const NCAA_MEN = '80300000-0000-4000-8000-000000000003';
    const BRACKETS = [
      template('ncaa-men-bracket-doubling', {
        id: 'tpl-full-bracket', sport: 'BASKETBALL', sportLeagueId: NCAA_MEN, contestFormat: 'PREDICTION', selectionType: 'BRACKET',
        configuration: { selectionType: 'BRACKET', startsAtRound: 1, maxEntriesPerSquad: 1 },
      }),
      template('ncaa-men-bracket-second-chance', {
        id: 'tpl-second-chance', sport: 'BASKETBALL', sportLeagueId: NCAA_MEN, contestFormat: 'PREDICTION', selectionType: 'BRACKET',
        isDefault: false, sortOrder: 2, configuration: { selectionType: 'BRACKET', startsAtRound: 3, maxEntriesPerSquad: 1 },
      }),
    ];
    const MARCH_MADNESS = {
      ...NFL_WEEK, id: 'march-madness', sport: 'BASKETBALL', name: 'March Madness', participantCount: 64, rounds: 6, sportLeagueId: NCAA_MEN,
    };
    const MARCH_MADNESS_UNDER_WAY = {
      ...MARCH_MADNESS, status: 'IN_PROGRESS', readinessStatus: 'EVENT_STARTED', readinessReasons: ['EVENT_STARTED'], contestEligible: false,
    };

    function primeBrackets(event: Record<string, unknown>) {
      primeMocks('COMMISSIONER');
      listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: BRACKETS } });
      listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [{ id: NCAA_MEN, name: 'NCAA Men', sport: 'BASKETBALL', participantType: null, scoringFamily: null, isActive: true }] } });
      listEventsMock.mockImplementation((options: { query?: { sport?: string } }) => Promise.resolve({
        data: { events: options.query?.sport === 'BASKETBALL' ? [event] : [] },
      }));
    }

    it('links the full bracket before the tournament starts, but not its second-chance variation', async () => {
      primeBrackets(MARCH_MADNESS);
      renderPage();

      expect(await screen.findByTestId('contest-type-ncaa-men-create-ncaa-men-bracket-doubling')).toHaveTextContent('Create this contest');
      expect(screen.getByTestId('contest-type-ncaa-men-ncaa-men-bracket-doubling-variations')).toHaveTextContent('ncaa-men-bracket-second-chance name');
      // Its link stands while the events load, and goes once they show no event can start it.
      await waitFor(() => expect(screen.queryByTestId('contest-type-ncaa-men-create-ncaa-men-bracket-second-chance')).not.toBeInTheDocument());
      expect(screen.getByTestId('contest-type-ncaa-men-create-ncaa-men-bracket-doubling')).toBeInTheDocument();
    });

    it('links the second chance once the tournament is under way and says the full bracket has no event left', async () => {
      primeBrackets(MARCH_MADNESS_UNDER_WAY);
      renderPage();

      expect(await screen.findByTestId('contest-type-ncaa-men-no-events-ncaa-men-bracket-doubling')).toHaveTextContent('No upcoming events yet');
      expect(screen.getByTestId('contest-type-ncaa-men-create-ncaa-men-bracket-second-chance')).toBeInTheDocument();
    });
  });

  it('says the contest types could not be loaded when the template list fails, rather than showing an empty menu', async () => {
    primeMocks('MEMBER');
    listContestConfigTemplatesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'boom' } }, response: { status: 500 } });
    renderPage();

    expect(await screen.findByText("We couldn't load the contest types.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
