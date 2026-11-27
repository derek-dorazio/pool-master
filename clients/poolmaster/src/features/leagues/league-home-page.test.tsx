import { coverageOfEvents } from '@/features/contests/test/covered-slots';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanFeature, Sport } from '@poolmaster/shared/domain';
import { bindApiMocks } from '@/test/msw-api';
import { sportPlay } from '@/test/sport-play';
import { AuthProvider } from '@/features/auth/auth-provider';
import { LeagueHomePage } from './league-home-page';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquad,
  buildLeagueSquadMember,
  getLeagueByCodeData,
  getLeagueSquadFrom,
} from './test/fixtures';
import type { ContestDto, ContestResultSummaryDto, CupDto } from '@/lib/api';
import { buildContestResult, buildRunningCup } from '@/features/championships/test/fixtures';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';

const getCurrentUserMock = vi.fn();
const getContestLeaderboardMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const getYearReviewMock = vi.fn();
const listMyContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listCupsMock = vi.fn();
const listContestResultsMock = vi.fn();
const getEventBracketMock = vi.fn();
const getLeagueSquadMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  getUser: getCurrentUserMock,
  getContestLeaderboard: getContestLeaderboardMock,
  getLeagueByCode: getLeagueByCodeMock,
  getYearReview: getYearReviewMock,
  listMyContestEntries: listMyContestEntriesMock,
  listContests: listContestsMock,
  listCups: listCupsMock,
  listContestResults: listContestResultsMock,
  getEventBracket: getEventBracketMock,
  getLeagueSquad: getLeagueSquadMock,
  refreshToken: refreshTokenMock,
});

const NOW = new Date('2026-04-10T12:00:00.000Z');

function HistoryStateProbe() {
  return <div data-testid="history-state">{JSON.stringify(useLocation().state ?? null)}</div>;
}

function GoToOtherLeague() {
  const navigate = useNavigate();
  return (
    <button onClick={() => {
        void navigate('/league/NEWDOGS');
      }} type="button">
      Other league
    </button>
  );
}

function renderLeagueHome(initialEntry: string | { pathname: string; state: unknown } = '/league/BIGDAWGS') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              element={(
                <>
                  <GoToOtherLeague />
                  <HistoryStateProbe />
                  <LeagueHomePage />
                </>
              )}
              path="/league/:leagueCode"
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

type ContestStatus = 'DRAFT' | 'OPEN' | 'ACTIVE' | 'COMPLETED';

function contest(id: string, name: string, status: ContestStatus, sportEventId = `event-${id}`, entryCount = 4) {
  const sportEvents = [{ sportEventId, name: `Event ${sportEventId}`, startDate: '2026-05-01T12:00:00.000Z', status: 'SCHEDULED', endDate: null, ...sportPlay(Sport.GOLF) }] as ContestDto['sportEvents'];
  return {
    ...coverageOfEvents({ sportEvents }),
    id,
    name,
    status,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    leagueId: 'league-1',
    sportEvents,
    sport: 'GOLF',
    entryCount,
    entriesPerContest: null as number | null,
  };
}

function entry(contestId: string, squadId: string, status: 'DRAFT' | 'SUBMITTED' = 'SUBMITTED') {
  return {
    id: `${contestId}-${squadId}`,
    contestId,
    squadId,
    squadName: squadId,
    entryNumber: 1,
    name: `${squadId} entry`,
    events: [{ sportEventId: `event-${contestId}`, status, submittedAt: status === 'SUBMITTED' ? '2026-04-02T00:00:00.000Z' : null }],
    picksCount: 6,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}


function standing(position: number, squadId: string, entryName: string, totalScore: number) {
  return {
    entryId: `entry-${squadId}`,
    entryName,
    entryNumber: 1,
    squadId,
    squadName: `${entryName}'s team`,
    position,
    displayPosition: String(position),
    countingPickLimit: 4,
    scoredPickCount: 4,
    totalScore,
    events: [{ sportEventId: 'event-1', totalScore, position, displayPosition: String(position) }],
    picks: [],
  };
}

function liveLeaderboard(contestId: string, entries: ReturnType<typeof standing>[]) {
  return {
    contestId,
    sportEventId: `event-${contestId}`,
    sport: 'GOLF',
    ...sportPlay(Sport.GOLF),
    scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    countingRule: { type: 'BEST_N', count: 4, pickCount: 6 },
    upsetBonus: false,
    participants: [],
    asOf: null,
    entries,
  };
}

function primeMocks({
  contests = [] as ReturnType<typeof contest>[],
  entriesByContest = {},
  cups = [] as CupDto[],
  eventStarts = {},
  isActive = true,
  hasTeam = true,
  role = 'MEMBER',
  features = Object.values(PlanFeature),
  description = null,
  places = [],
  finals = [],
}: {
  description?: string | null;
  /** The championship year's finished contests, as the results read lists them. */
  finals?: ContestResultSummaryDto[];
  places?: { entryId: string; position: number; displayPosition: string }[];
  features?: PlanFeature[];
  contests?: ReturnType<typeof contest>[];
  cups?: CupDto[];
  entriesByContest?: Record<string, ReturnType<typeof entry>[]>;
  eventStarts?: Record<string, string>;
  isActive?: boolean;
  hasTeam?: boolean;
  role?: 'MEMBER' | 'COMMISSIONER';
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague({ description, isActive, memberCount: 12, activeContestCount: 2, planEntitlements: buildPlanEntitlements({ features }) }),
    {
      membership: buildLeagueMembership({ role }),
      squadMembership: hasTeam ? buildLeagueSquadMember() : null,
    },
  )));
  // The contest list carries each contest's event start, which is when its entries close.
  listContestsMock.mockResolvedValue(apiSuccess({
    contests: contests.map((listed) => ({
      ...listed,
      sportEvents: listed.sportEvents.map((sportEvent) => ({
        ...sportEvent,
        startDate: eventStarts[sportEvent.sportEventId] ?? sportEvent.startDate,
      })),
    })),
  }));
  getLeagueSquadMock.mockImplementation(getLeagueSquadFrom(
    hasTeam ? [buildLeagueSquad({ members: [buildLeagueSquadMember()] })] : [],
  ));
  listCupsMock.mockResolvedValue(apiSuccess({ cups }));
  listContestResultsMock.mockResolvedValue(apiSuccess({ contests: finals }));
  getYearReviewMock.mockResolvedValue(apiSuccess({ yearReview: { year: 2025, status: 'READY', sentAt: null, sentByName: null } }));
  // The viewer's team's entries across the league's current contests, in one read (#1197).
  listMyContestEntriesMock.mockResolvedValue(apiSuccess({ entries: Object.values(entriesByContest).flat(), places }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  for (const mock of [
    getCurrentUserMock, getContestLeaderboardMock, getLeagueByCodeMock, getYearReviewMock,
    listMyContestEntriesMock, listContestsMock, listCupsMock, getLeagueSquadMock, refreshTokenMock,
    listContestResultsMock, getEventBracketMock,
  ]) {
    mock.mockReset();
  }
});

describe('League Home', () => {
  it('tells the commissioner last year\'s year in review is ready to send, and never asks for it for a member', async () => {
    primeMocks({ role: 'COMMISSIONER' });
    const { unmount } = renderLeagueHome();
    expect(await screen.findByTestId('year-review-ready')).toHaveTextContent('Your 2025 year in review is ready to send');
    unmount();

    getYearReviewMock.mockClear();
    primeMocks();
    renderLeagueHome();
    expect(await screen.findByTestId('league-home-identity')).toBeInTheDocument();
    expect(getYearReviewMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('year-review-ready')).not.toBeInTheDocument();
  });

  it('shows the league once, compactly: name and counts, with no league code members could not use', async () => {
    primeMocks();

    renderLeagueHome();

    const identity = within(await screen.findByTestId('league-home-identity'));
    expect(identity.getByRole('heading', { name: 'Big Dawgs' })).toBeInTheDocument();
    expect(screen.queryByText('BIGDAWGS')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy league code' })).not.toBeInTheDocument();
    expect(identity.getByText('12 members · 2 active contests')).toBeInTheDocument();
  });

  it("shows the commissioner's league description in the header, under the counts", async () => {
    primeMocks({ description: 'Saturday golf and Sunday football since 2009.' });

    renderLeagueHome();

    const identity = within(await screen.findByTestId('league-home-identity'));
    expect(identity.getByTestId('league-home-description')).toHaveTextContent('Saturday golf and Sunday football since 2009.');
  });

  it('shows no description line when the league has none', async () => {
    primeMocks({ description: '   ' });

    renderLeagueHome();

    await screen.findByTestId('league-home-identity');
    expect(screen.queryByTestId('league-home-description')).not.toBeInTheDocument();
  });

  it('draws an open contest as a hero with its kind, when entries close, a countdown and Make your picks', async () => {
    primeMocks({
      contests: [contest('sooner', 'RBC Heritage Tiers', 'OPEN', 'event-sooner', 11)],
      eventStarts: { 'event-sooner': '2026-04-13T02:06:00.000Z' },
    });

    renderLeagueHome();

    const hero = within(await screen.findByTestId('league-home-hero-sooner'));
    expect(hero.getByRole('heading', { name: 'RBC Heritage Tiers' })).toBeInTheDocument();
    expect(hero.getByText('Open for entries · Tiered')).toBeInTheDocument();
    expect(hero.getByRole('timer')).toHaveAccessibleName('Entries close in 2 days 14 hours 6 minutes');
    expect(await hero.findByRole('button', { name: 'Make your picks' })).toBeInTheDocument();
    expect(hero.getByTestId('league-home-hero-sooner-note')).toHaveTextContent('11 entries so far');
    // A tap anywhere else on the hero opens the contest page.
    expect(hero.getByTestId('league-home-hero-sooner-link')).toHaveAttribute('href', '/league/BIGDAWGS/contests/sooner');
    expect(hero.getByTestId('league-home-hero-sooner-link')).toHaveAccessibleName('RBC Heritage Tiers');
  });

  it('offers Edit picks and Add entry on an open hero once the team is in, saying which entry is in', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')],
      entriesByContest: { 'open-1': [entry('open-1', 'team-1')] },
    });

    renderLeagueHome();

    const hero = within(await screen.findByTestId('league-home-hero-open-1'));
    expect(await hero.findByRole('link', { name: 'Edit picks' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/open-1/entries/open-1-team-1');
    expect(hero.getByRole('button', { name: 'Add entry' })).toBeInTheDocument();
    expect(hero.getByTestId('league-home-hero-open-1-note')).toHaveTextContent('team-1 entry is in');
  });

  it('offers to finish the picks on a hero when the team has an entry it has not submitted', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')],
      entriesByContest: { 'open-1': [entry('open-1', 'team-1', 'DRAFT')] },
    });

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-hero-open-1')).findByRole('link', { name: 'Finish your picks' })).toBeInTheDocument();
  });

  it('draws at most three heroes, live first then open by soonest closing, and lists the rest under More contests', async () => {
    primeMocks({
      contests: [
        contest('open-late', 'US Open Pick 6', 'OPEN'),
        contest('open-soon', 'RBC Heritage Tiers', 'OPEN'),
        contest('live-1', 'Masters Pick 6', 'ACTIVE'),
        contest('open-mid', 'PGA Budget', 'OPEN'),
      ],
      eventStarts: { 'event-open-soon': '2026-04-12T12:00:00.000Z', 'event-open-mid': '2026-04-20T12:00:00.000Z', 'event-open-late': '2026-06-18T12:00:00.000Z' },
    });
    getContestLeaderboardMock.mockResolvedValue(apiSuccess(liveLeaderboard('live-1', [standing(1, 'team-a', 'Bogey Men', -14)])));

    renderLeagueHome();

    const heroes = await screen.findByTestId('league-home-heroes');
    expect(within(heroes).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Masters Pick 6', 'RBC Heritage Tiers', 'PGA Budget']);
    const more = within(screen.getByTestId('league-home-more-contests'));
    expect(more.getByRole('heading', { name: 'More contests' })).toBeInTheDocument();
    expect(more.getByTestId('league-home-contest-open-late')).toHaveTextContent('US Open Pick 6');
    expect(more.queryByTestId('league-home-contest-live-1')).not.toBeInTheDocument();
  });

  it('reads the team\'s entries for every open and live contest in one league-wide request, not one per contest', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN'), contest('open-2', 'US Open Pick 6', 'OPEN')],
      entriesByContest: { 'open-1': [entry('open-1', 'team-1', 'DRAFT')] },
    });

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-hero-open-1')).findByRole('link', { name: 'Finish your picks' })).toBeInTheDocument();
    expect(listMyContestEntriesMock).toHaveBeenCalledTimes(1);
    expect(listMyContestEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
  });

  it('does not offer to make picks while it is still checking whether the team has entered', async () => {
    primeMocks({ contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')] });
    listMyContestEntriesMock.mockImplementation(() => new Promise(() => undefined));

    renderLeagueHome();

    const hero = within(await screen.findByTestId('league-home-hero-open-1'));
    expect(await hero.findByText('Checking your entry...')).toBeInTheDocument();
    expect(hero.queryByRole('button', { name: 'Make your picks' })).not.toBeInTheDocument();
  });

  it('says it could not check the entry, rather than offering picks, when the entries cannot be loaded', async () => {
    primeMocks({ contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')] });
    listMyContestEntriesMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Entries unavailable' } },
    });

    renderLeagueHome();

    const hero = within(await screen.findByTestId('league-home-hero-open-1'));
    expect(await hero.findByText("We couldn't check your entry.")).toBeInTheDocument();
    expect(hero.queryByRole('button', { name: 'Make your picks' })).not.toBeInTheDocument();
  });

  it('makes no hero of a contest whose cutoff has passed, even while it still reads open, listing it under Contests', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')],
      eventStarts: { 'event-open-1': '2026-04-10T11:00:00.000Z' },
    });

    renderLeagueHome();

    const card = within(await screen.findByTestId('league-home-more-contests'));
    expect(card.getByRole('heading', { name: 'Contests' })).toBeInTheDocument();
    expect(card.getByTestId('league-home-contest-open-1')).toHaveTextContent('RBC Heritage Tiers');
    expect(screen.queryByTestId('league-home-heroes')).not.toBeInTheDocument();
  });

  it('lists a full contest under More contests as Full, not as a hero', async () => {
    primeMocks({ contests: [{ ...contest('full', 'Masters Tiered', 'OPEN', 'event-full', 100), entriesPerContest: 100 }] });

    renderLeagueHome();

    expect(await screen.findByTestId('league-home-contest-full-full')).toHaveTextContent('Full');
    expect(screen.queryByTestId('league-home-heroes')).not.toBeInTheDocument();
  });

  it('draws a live contest the team is in as a hero: its place in big type, the top three plus its own row, and Leaderboard', async () => {
    primeMocks({
      contests: [contest('live-1', 'Masters Pick 6', 'ACTIVE', 'event-live-1', 7)],
      // The entry the leaderboard ranks 7th is the team's own.
      entriesByContest: { 'live-1': [{ ...entry('live-1', 'team-1'), id: 'entry-team-1' }] },
      places: [{ entryId: 'entry-team-1', position: 7, displayPosition: '7' }],
    });
    getContestLeaderboardMock.mockResolvedValue(apiSuccess(liveLeaderboard('live-1', [
      standing(1, 'team-a', 'Bogey Men', -14),
      standing(2, 'team-b', 'Sand Trappers', -11),
      standing(3, 'team-c', 'Grip It', -10),
      standing(4, 'team-d', 'Mulligans', -8),
      standing(7, 'team-1', 'Casey Crushers', -5),
    ])));

    renderLeagueHome();

    const hero = within(await screen.findByTestId('league-home-hero-live-1'));
    expect(hero.getByText('Live')).toBeInTheDocument();
    expect(await hero.findByText('1 · Bogey Men')).toBeInTheDocument();
    expect(hero.getByText('3 · Grip It')).toBeInTheDocument();
    expect(hero.queryByText(/Mulligans/)).not.toBeInTheDocument();
    expect(screen.getByTestId('league-home-hero-live-1-standing-entry-team-1')).toHaveTextContent('7 · Casey Crushers (you)');
    expect(screen.getByTestId('league-home-hero-live-1-standing-entry-team-1')).toHaveAttribute('data-mine', 'true');
    expect(screen.getByTestId('league-home-hero-live-1-place')).toHaveTextContent('7thof 7 · -5');
    expect(hero.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/live-1');
  });

  it('draws a live contest the team is not in with the top three and Watch, no place and no row of its own', async () => {
    primeMocks({ contests: [contest('live-1', 'Masters Pick 6', 'ACTIVE')] });
    getContestLeaderboardMock.mockResolvedValue(apiSuccess(liveLeaderboard('live-1', [standing(1, 'team-a', 'Bogey Men', -14)])));

    renderLeagueHome();

    const hero = within(await screen.findByTestId('league-home-hero-live-1'));
    expect(await hero.findByText('1 · Bogey Men')).toBeInTheDocument();
    expect(screen.queryByTestId('league-home-hero-live-1-place')).not.toBeInTheDocument();
    expect(hero.queryByText(/\(you\)/)).not.toBeInTheDocument();
    expect(hero.getByRole('link', { name: 'Watch' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/live-1');
  });

  it('makes one request each for the league, its contests and the team\'s entries, and one leaderboard per live hero', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN'), contest('live-1', 'Masters Pick 6', 'ACTIVE'), contest('live-2', 'NBA Finals Stars', 'ACTIVE')],
      entriesByContest: { 'live-1': [entry('live-1', 'team-1')] },
    });
    getContestLeaderboardMock.mockImplementation(({ path }: { path: { contestId: string } }) => apiSuccess(liveLeaderboard(
      path.contestId,
      [standing(1, 'team-1', 'Casey Crushers', -5)],
    )));

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-hero-live-2')).findByText(/Casey Crushers/)).toBeInTheDocument();
    expect(getLeagueByCodeMock).toHaveBeenCalledTimes(1);
    expect(listContestsMock).toHaveBeenCalledTimes(1);
    expect(listMyContestEntriesMock).toHaveBeenCalledTimes(1);
    expect(getContestLeaderboardMock).toHaveBeenCalledTimes(2);
    // One results read, for the contests gone final lately; no games read: the list counts progress.
    expect(listContestResultsMock).toHaveBeenCalledTimes(1);
    expect(getEventBracketMock).not.toHaveBeenCalled();
  });

  it('shows a live hero\'s progress as the contest list counts it, reading no games for it', async () => {
    const week = { ...contest('week-1', 'Week 12 Pick\'em', 'ACTIVE'), contestFormat: 'PREDICTION', selectionType: 'PICK_EM', progress: { played: 2, total: 3, unit: 'GAMES' } };
    primeMocks({ contests: [week] });
    getContestLeaderboardMock.mockResolvedValue(apiSuccess(liveLeaderboard('week-1', [standing(1, 'team-a', 'Bogey Men', 3)])));

    renderLeagueHome();

    expect(await screen.findByTestId('league-home-hero-week-1-progress')).toHaveTextContent('2 of 3 games played');
    expect(getEventBracketMock).not.toHaveBeenCalled();
  });

  it('keeps a contest gone final in the last few days in More contests with the team\'s finish, asking the server for only those days', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')],
      finals: [buildContestResult({ completedAt: '2026-04-09T12:00:00.000Z', contestId: 'week-11', name: 'Week 11 Pick\'em', rankedEntryCount: 14, squadFinish: { displayPlace: '5', place: 5, points: 0 } })],
    });

    renderLeagueHome();

    expect(await screen.findByTestId('league-home-final-week-11')).toHaveTextContent('Final · you were 5th of 14');
    // The server narrows the year's results to the last few days, from a day boundary.
    expect(listContestResultsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1' },
      query: { finishOf: buildLeagueSquadMember().squadId, finishedSince: '2026-04-07T00:00:00.000Z', year: 2026 },
    }));
  });

  it('shows no Up next, Live standings or Your team card any more', async () => {
    primeMocks({ contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')] });

    renderLeagueHome();

    await screen.findByTestId('league-home-hero-open-1');
    expect(screen.queryByTestId('league-home-up-next')).not.toBeInTheDocument();
    expect(screen.queryByTestId('league-home-live-standings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('league-home-your-team')).not.toBeInTheDocument();
    expect(getLeagueSquadMock).not.toHaveBeenCalled();
  });

  it('tints and scrolls to the contest a contest page\'s Home breadcrumb came from', async () => {
    primeMocks({ contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')] });

    renderLeagueHome('/league/BIGDAWGS?focus=open-1');

    expect(await screen.findByTestId('league-home-hero-open-1')).toHaveAttribute('data-highlighted', 'true');
  });

  it('shows the year\'s cups with who leads and the viewer\'s place, each opening its Points race', async () => {
    primeMocks({ cups: [buildRunningCup()] });

    renderLeagueHome();

    const cups = within(await screen.findByTestId('league-home-cups'));
    expect(listCupsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { seasonYear: 2026 } }));
    expect(cups.getByRole('heading', { name: '2026 cups' })).toBeInTheDocument();
    expect(cups.getByTestId('league-home-cup-cup-pga')).toHaveTextContent('Birdie Bandits leads · you are 2nd · 3 of 4 final');
    expect(cups.getByTestId('league-home-cup-cup-pga')).toHaveAttribute('href', '/league/BIGDAWGS/championships/2026/race/sport-league-pga');
    expect(cups.getByRole('link', { name: /Trophy case/ })).toHaveAttribute('href', '/league/BIGDAWGS/championships/2026/trophies');
  });

  it('shows no cups card and asks for no cups on a plan without them', async () => {
    primeMocks({ cups: [buildRunningCup()], features: Object.values(PlanFeature).filter((feature) => feature !== PlanFeature.CUP_STANDINGS) });

    renderLeagueHome();

    await screen.findByTestId('league-home-more-contests');
    expect(listCupsMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('league-home-cups')).not.toBeInTheDocument();
  });

  it('offers the commissioner no year in review on a plan without its email', async () => {
    primeMocks({ role: 'COMMISSIONER', features: Object.values(PlanFeature).filter((feature) => feature !== PlanFeature.EMAIL_YEAR_IN_REVIEW) });

    renderLeagueHome();

    await screen.findByTestId('league-home-identity');
    expect(getYearReviewMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('year-review-ready')).not.toBeInTheDocument();
  });

  it('shows no cups card before the league has a contest in the year', async () => {
    primeMocks();

    renderLeagueHome();

    await screen.findByTestId('league-home-more-contests');
    await vi.waitFor(() => expect(listCupsMock).toHaveBeenCalled());
    expect(screen.queryByTestId('league-home-cups')).not.toBeInTheDocument();
  });

  it('asks a member with no team to create their team, rather than offering picks', async () => {
    primeMocks({ hasTeam: false, contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')] });

    renderLeagueHome();

    const hero = within(await screen.findByTestId('league-home-hero-open-1'));
    expect(hero.getByText('Create your team to enter.')).toBeInTheDocument();
    expect(hero.queryByRole('button', { name: 'Make your picks' })).not.toBeInTheDocument();
    expect(listMyContestEntriesMock).not.toHaveBeenCalled();
  });

  it('shows a set-up contest to a commissioner under Contests, and to no member', async () => {
    primeMocks({ role: 'COMMISSIONER', contests: [contest('draft', 'Super Bowl Squares', 'DRAFT')] });
    const { unmount } = renderLeagueHome();
    expect(await screen.findByTestId('league-home-contest-draft-status')).toHaveTextContent(/^Set up/);
    unmount();

    primeMocks({ contests: [contest('draft', 'Super Bowl Squares', 'DRAFT')] });
    renderLeagueHome();
    expect(await screen.findByTestId('league-home-contest-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('league-home-contest-draft')).not.toBeInTheDocument();
  });

  it('keeps a titled Contests card with one italic line when no contest is open or live, linking to no contests page', async () => {
    primeMocks({ contests: [contest('done', 'Players Championship', 'COMPLETED')] });

    renderLeagueHome();

    const card = within(await screen.findByTestId('league-home-more-contests'));
    expect(card.getByRole('heading', { name: 'Contests' })).toBeInTheDocument();
    expect(card.getByTestId('league-home-contest-empty')).toHaveTextContent('No open or live contests.');
    expect(card.queryByRole('link', { name: /All contests/ })).not.toBeInTheDocument();
  });

  it('shows an error instead of an empty page when the contests cannot be loaded', async () => {
    primeMocks();
    listContestsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } } });

    renderLeagueHome();

    expect(await screen.findByText("We couldn't load this league's contests.")).toBeInTheDocument();
    expect(screen.queryByTestId('league-home-more-contests')).not.toBeInTheDocument();
  });

  it('explains that an inactive league is read-only', async () => {
    primeMocks({ isActive: false });

    renderLeagueHome();

    expect(await screen.findByTestId('league-inactive-banner')).toHaveTextContent('This league is not currently active.');
  });

  it('shows the load-error copy with a way back to welcome when the league cannot be loaded', async () => {
    primeMocks();
    getLeagueByCodeMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'Not found' } },
      response: { status: 404 },
    });

    renderLeagueHome();

    expect(await screen.findByRole('link', { name: 'Back to welcome' })).toHaveAttribute('href', '/welcome');
  });
});

describe('League Home after joining', () => {
  const joinedWithFailedTeamSetup = { pathname: '/league/BIGDAWGS', state: { teamSetupFailed: true } };

  it('tells a member who just joined that their team\'s name and icon did not save, linking to where they can set them', async () => {
    primeMocks();

    renderLeagueHome(joinedWithFailedTeamSetup);

    const notice = await screen.findByTestId('league-team-setup-failed');
    expect(notice).toHaveTextContent("we couldn't save your team's name and icon.");
    expect(within(notice).getByRole('link', { name: 'Set up your team' })).toHaveAttribute('href', '/league/BIGDAWGS/team');
  });

  it('shows the team-setup notice once, clearing it from history so Back or a reload does not bring it back', async () => {
    primeMocks();

    renderLeagueHome(joinedWithFailedTeamSetup);

    expect(await screen.findByTestId('league-team-setup-failed')).toBeInTheDocument();
    expect(await screen.findByTestId('history-state')).toHaveTextContent('null');
  });

  it('does not carry the team-setup notice to another league', async () => {
    primeMocks();

    renderLeagueHome(joinedWithFailedTeamSetup);

    expect(await screen.findByTestId('league-team-setup-failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Other league' }));
    await screen.findByTestId('league-home');
    expect(screen.queryByTestId('league-team-setup-failed')).not.toBeInTheDocument();
  });

  it('shows no team-setup notice on an ordinary visit', async () => {
    primeMocks();

    renderLeagueHome();

    await screen.findByTestId('league-home');
    expect(screen.queryByTestId('league-team-setup-failed')).not.toBeInTheDocument();
  });
});
