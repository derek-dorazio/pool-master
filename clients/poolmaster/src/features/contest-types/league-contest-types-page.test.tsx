import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
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

function primeMocks(role: 'COMMISSIONER' | 'MEMBER') {
  getLeagueByCodeMock.mockResolvedValue({
    data: {
      league: { id: 'league-1', leagueCode: 'BIGDAWGS', name: 'Big Dawgs', isActive: true, iconKey: 'TROPHY', memberCount: 2, activeContestCount: 0, createdAt: '2026-04-15T00:00:00.000Z' },
      membership: { id: 'membership-1', leagueId: 'league-1', userId: 'user-1', role, status: 'ACTIVE', joinedAt: '2026-04-15T00:00:00.000Z', createdAt: '2026-04-15T00:00:00.000Z', updatedAt: '2026-04-15T00:00:00.000Z' },
      squadMembership: null,
    },
  });
  listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: TEMPLATES } });
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [{ id: NFL, name: 'NFL', sport: 'AMERICAN_FOOTBALL', participantType: null, scoringFamily: null }, { id: NBA, name: 'NBA', sport: 'BASKETBALL', participantType: null, scoringFamily: null }] } });
  listEventsMock.mockImplementation((options: { query?: { sport?: string } }) => Promise.resolve({
    data: { events: options.query?.sport === 'AMERICAN_FOOTBALL' ? [NFL_WEEK] : [] },
  }));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/league/BIGDAWGS/contest-types']}>
        <Routes>
          <Route element={<LeagueContestTypesPage />} path="/league/:leagueCode/contest-types" />
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
    const tiered = within(football).getByTestId('contest-type-nfl-tiered-doubling');
    expect(tiered).toHaveTextContent('nfl-tiered-doubling name');
    expect(tiered).toHaveTextContent('nfl-tiered-doubling description.');
    expect(within(tiered).getByTestId('contest-type-nfl-tiered-doubling-variations')).toHaveTextContent('nfl-tiered-doubling-upset-bonus name');
    expect(screen.getByTestId('contest-types-sport-BASKETBALL')).toHaveTextContent('NBA');
  });

  it('says a stat pool league\'s group is a Clutch Card and how its players score, and nothing of the kind on its sport\'s own league', async () => {
    primeMocks('MEMBER');
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [...TEMPLATES, template('nba-finals-tiered', { id: 'tpl-nba-finals', sport: 'BASKETBALL', sportLeagueId: 'nba-finals', eventType: null })] } });
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [
      { id: NBA, name: 'NBA', sport: 'BASKETBALL', participantType: null, scoringFamily: null },
      { id: 'nba-finals', name: 'NBA Finals', sport: 'BASKETBALL', participantType: 'INDIVIDUAL', scoringFamily: 'COMPOSITE' },
    ] } });
    renderPage();

    expect(await screen.findByTestId('contest-types-stat-pool-nba-finals'))
      .toHaveTextContent('Clutch Card. Each star scores Triple Threat: points + rebounds + assists, each game.');
    expect(screen.queryByTestId(`contest-types-stat-pool-${NBA}`)).not.toBeInTheDocument();
  });

  it('gives a member the menu without any create links, so they can see what else the league could run', async () => {
    primeMocks('MEMBER');
    renderPage();

    await screen.findByTestId('contest-type-nfl-tiered-doubling');
    expect(screen.getByTestId('league-contest-types-page')).toHaveTextContent('Ask your commissioner');
    expect(screen.queryByText('Create this contest')).not.toBeInTheDocument();
    expect(screen.queryByText('No upcoming events yet')).not.toBeInTheDocument();
    expect(listEventsMock).not.toHaveBeenCalled();
  });

  it('gives a commissioner a create link on each type with an event coming up, opening Create contest on that template, and says when a type has none', async () => {
    primeMocks('COMMISSIONER');
    renderPage();

    const pickEm = await screen.findByTestId('contest-type-create-nfl-pick-em-straight-up');
    expect(pickEm).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/new?template=tpl-nfl-pick-em');
    expect(await screen.findByTestId('contest-type-no-events-nfl-tiered-doubling')).toHaveTextContent('No upcoming events yet');
    expect(screen.getByTestId('contest-type-no-events-nba-tiered-doubling')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-type-create-nfl-tiered-doubling-upset-bonus')).not.toBeInTheDocument();
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
      listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [{ id: NCAA_MEN, name: 'NCAA Men', sport: 'BASKETBALL', participantType: null, scoringFamily: null }] } });
      listEventsMock.mockImplementation((options: { query?: { sport?: string } }) => Promise.resolve({
        data: { events: options.query?.sport === 'BASKETBALL' ? [event] : [] },
      }));
    }

    it('links the full bracket before the tournament starts, but not its second-chance variation', async () => {
      primeBrackets(MARCH_MADNESS);
      renderPage();

      expect(await screen.findByTestId('contest-type-create-ncaa-men-bracket-doubling')).toHaveTextContent('Create this contest');
      expect(screen.getByTestId('contest-type-ncaa-men-bracket-doubling-variations')).toHaveTextContent('ncaa-men-bracket-second-chance name');
      // Its link stands while the events load, and goes once they show no event can start it.
      await waitFor(() => expect(screen.queryByTestId('contest-type-create-ncaa-men-bracket-second-chance')).not.toBeInTheDocument());
      expect(screen.getByTestId('contest-type-create-ncaa-men-bracket-doubling')).toBeInTheDocument();
    });

    it('links the second chance once the tournament is under way and says the full bracket has no event left', async () => {
      primeBrackets(MARCH_MADNESS_UNDER_WAY);
      renderPage();

      expect(await screen.findByTestId('contest-type-no-events-ncaa-men-bracket-doubling')).toHaveTextContent('No upcoming events yet');
      expect(screen.getByTestId('contest-type-create-ncaa-men-bracket-second-chance')).toBeInTheDocument();
    });
  });

  it('says the contest types could not be loaded when the template list fails, rather than showing an empty menu', async () => {
    primeMocks('MEMBER');
    listContestConfigTemplatesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'boom' } }, response: { status: 500 } });
    renderPage();

    expect(await screen.findByText('Contest types unavailable')).toBeInTheDocument();
  });
});
