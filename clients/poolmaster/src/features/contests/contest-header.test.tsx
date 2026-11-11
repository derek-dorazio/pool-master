import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContestDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryFrame, ContestPageFrame } from './contest-header';
import { entryPageView, type ContestView } from './contest-page-view';

const { getLeagueMock } = vi.hoisted(() => ({ getLeagueMock: vi.fn() }));

bindApiMocks({ getLeague: getLeagueMock });

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, isRootAdmin: false, user: { id: 'user-1', isRootAdmin: false }, clearSession: vi.fn() }),
}));

const contest = {
  endsAt: '2026-04-12T23:00:00.000Z',
  id: 'contest-1',
  leagueId: 'league-1',
  myEntryIds: ['entry-1'],
  name: 'Masters Pool',
  status: ContestStatus.ACTIVE,
} as ContestDto;

function leagueRead(leagueCode: string) {
  return { data: { league: { id: 'league-1', leagueCode, name: 'Big Dawgs' }, membership: null, squadMembership: null } };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

/** Draws `page` at `url` under `/league/:leagueCode/contests/:contestId/*`, with where the URL ends up. */
function renderAt(page: ReactNode, url = '/league/BIGDAWGS/contests/contest-1') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route element={<>{page}<LocationProbe /></>} path="/league/:leagueCode/contests/:contestId/*" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getLeagueMock.mockResolvedValue(leagueRead('BIGDAWGS'));
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderFrame({
  contestOverrides = {},
  current = 'entries',
  entryName,
  leagueCode = 'BIGDAWGS',
  myEntryIds = contest.myEntryIds,
  picksRevealed = true,
  title,
  url,
}: {
  contestOverrides?: Partial<ContestDto>;
  current?: ContestView | null;
  entryName?: string;
  leagueCode?: string;
  myEntryIds?: string[];
  picksRevealed?: boolean;
  title?: string;
  url?: string;
} = {}) {
  renderAt(
    <ContestPageFrame
      contest={{ ...contest, myEntryIds, ...contestOverrides }}
      current={current}
      entryName={entryName}
      leagueCode={leagueCode}
      picksRevealed={picksRevealed}
      testId="frame"
      title={title}
      headerTestId="frame-header"
    >
      <p>Page body</p>
    </ContestPageFrame>,
    url,
  );
}

function breadcrumbs() {
  return within(screen.getByRole('navigation', { name: 'Contest breadcrumbs' }));
}

describe('ContestPageFrame', () => {
  it('heads the page with the contest name in the plain page header, with no card around it, and the body underneath', () => {
    renderFrame();

    expect(screen.getByRole('heading', { level: 1, name: 'Masters Pool' })).toHaveAttribute('data-testid', 'frame-header-name');
    expect(screen.getByTestId('frame-header').tagName).toBe('HEADER');
    expect(screen.getByTestId('frame-header-title-row')).not.toHaveClass('bg-card', 'rounded-lg');
    expect(screen.getByTestId('frame')).toHaveTextContent('Page body');
  });

  it('shows the contest\'s status badge in the header\'s status slot, on the breadcrumb line', () => {
    renderFrame();

    const status = screen.getByTestId('frame-header-status-slot');
    expect(status).toHaveTextContent('Live');
    expect(screen.getByTestId('frame-header-trail-row')).toContainElement(status);
  });

  it('heads the page with its own title when it is about one entry', () => {
    renderFrame({ title: 'Casey Crushers 1' });

    expect(screen.getByTestId('frame-header-name')).toHaveTextContent('Casey Crushers 1');
  });

  it('offers Leaderboard, Entries and My entry in that order once picks are revealed and the viewer has one entry, on the current page', () => {
    renderFrame({ current: 'leaderboard' });

    const options = within(screen.getByRole('navigation', { name: 'Contest pages' })).getAllByRole('link');
    expect(options.map((option) => option.getAttribute('data-testid'))).toEqual([
      'contest-menu-leaderboard',
      'contest-menu-entries',
      'contest-menu-my-entry',
    ]);
    expect(screen.getByTestId('contest-menu-leaderboard')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('My entry')).toBeInTheDocument();
  });

  it('opens the viewer\'s only entry from My entry', () => {
    renderFrame();

    fireEvent.click(screen.getByTestId('contest-menu-my-entry'));

    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1/entries/entry-1');
  });

  it('names the option My entries and opens Entries showing only the viewer\'s when they have two or more entries', () => {
    renderFrame({ myEntryIds: ['entry-1', 'entry-2'] });

    expect(screen.getByText('My entries')).toBeInTheDocument();
    expect(screen.queryByText('My entry')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-menu-my-entry'));

    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1?mine=1');
  });

  it('leaves out My entry when the viewer has no entry in the contest', () => {
    renderFrame({ myEntryIds: [] });

    expect(screen.getByTestId('contest-menu-leaderboard')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-menu-my-entry')).not.toBeInTheDocument();
  });

  it('leaves out Leaderboard until picks are revealed, since its read is refused before then', () => {
    renderFrame({ picksRevealed: false });

    expect(screen.getByTestId('contest-menu-entries')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('contest-menu-leaderboard')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-menu-my-entry')).toBeInTheDocument();
  });

  it('links each tab to its page, Leaderboard to the board and Entries to the contest', () => {
    renderFrame();

    expect(screen.getByTestId('contest-menu-leaderboard')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1/leaderboard');
    expect(screen.getByTestId('contest-menu-entries')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1');
  });

  it('selects no option on another team\'s entry page', () => {
    renderFrame({ current: null });

    expect(screen.getByTestId('contest-menu-entries')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('contest-menu-my-entry')).not.toHaveAttribute('aria-current');
  });
});

describe('entryPageView', () => {
  it('names the viewer\'s only entry page My entry and another team\'s entry page nothing', () => {
    expect(entryPageView(contest, 'entry-1')).toBe('my-entry');
    expect(entryPageView(contest, 'entry-9')).toBeNull();
    expect(entryPageView({ myEntryIds: undefined }, 'entry-1')).toBeNull();
  });

  it('names none of a viewer\'s several entry pages My entry, since My entries is then their list', () => {
    expect(entryPageView({ myEntryIds: ['entry-1', 'entry-2'] }, 'entry-1')).toBeNull();
  });
});

describe('The contest breadcrumb', () => {
  it('trails Contests then the contest\'s name on a contest page, Contests opening the Current tab on a live contest', () => {
    renderFrame();

    expect(breadcrumbs().getByRole('link', { name: 'Contests' })).toHaveAttribute('href', '/league/BIGDAWGS/contests?focus=contest-1');
    expect(breadcrumbs().getByText('Masters Pool')).toHaveAttribute('aria-current', 'page');
  });

  it('opens the Past tab at the year the contest ended, focused on it, from a final contest', () => {
    renderFrame({ contestOverrides: { status: ContestStatus.COMPLETED } });

    expect(breadcrumbs().getByRole('link', { name: 'Contests' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/history?year=2026&focus=contest-1',
    );
  });

  it('trails Contests, the contest and the entry on an entry page, the contest opening where it lands', () => {
    renderFrame({ current: null, entryName: 'Birdie Hunters 2', url: '/league/BIGDAWGS/contests/contest-1/entries/entry-9' });

    expect(breadcrumbs().getByRole('link', { name: 'Contests' })).toHaveAttribute('href', '/league/BIGDAWGS/contests?focus=contest-1');
    expect(breadcrumbs().getByRole('link', { name: 'Masters Pool' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1/leaderboard');
    expect(breadcrumbs().getByText('Birdie Hunters 2')).toHaveAttribute('aria-current', 'page');
  });

  it('shows no Back to league button, the breadcrumb being the way back', () => {
    renderFrame({ current: null, entryName: 'Birdie Hunters 2' });

    expect(screen.queryByRole('link', { name: 'Back to league' })).not.toBeInTheDocument();
  });
});

describe('A contest page under the wrong league', () => {
  it('replaces the URL with the same page under the contest\'s own league, keeping its search', async () => {
    getLeagueMock.mockResolvedValue(leagueRead('OFFICE24'));

    renderFrame({ url: '/league/BIGDAWGS/contests/contest-1/leaderboard?mine=1' });

    await vi.waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/league/OFFICE24/contests/contest-1/leaderboard?mine=1'));
  });

  it('stays on the page when the URL names the contest\'s own league', async () => {
    renderFrame();

    await vi.waitFor(() => expect(getLeagueMock).toHaveBeenCalled());
    expect(screen.getByTestId('frame-header-name')).toHaveTextContent('Masters Pool');
    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1');
  });
});

describe('ContestEntryFrame', () => {
  const entry = { createdAt: '2026-10-20T15:00:00.000Z', entryNumber: 2, squadName: 'Birdie Hunters', updatedAt: '2026-10-29T15:00:00.000Z' };

  function drawEntryFrame(status: ContestEntryStatus | null = ContestEntryStatus.DRAFT) {
    renderAt(
        <ContestEntryFrame
          contest={contest}
          entry={entry}
          entryId="entry-1"
          leagueCode="BIGDAWGS"
          phase="Open until the first game"
          picksRevealed={false}
          rules={['Confidence']}
          status={status}
          title="Birdie Hunters 2"
        >
          <p>The picks</p>
        </ContestEntryFrame>,
      '/league/BIGDAWGS/contests/contest-1/entries/entry-1',
    );
  }

  it('heads an entry page with the entry\'s name, its status icon instead of badges, and the contest, rules and squad in one line', () => {
    drawEntryFrame();

    expect(screen.getByTestId('contest-entry-header-name')).toHaveTextContent('Birdie Hunters 2');
    expect(screen.getByTestId('contest-entry-status')).toHaveAccessibleName('Entry status: Not submitted');
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-header-status-slot')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-summary')).toHaveTextContent('Masters Pool · Confidence · Birdie Hunters · Entry 2');
    expect(screen.getByText('The picks')).toBeInTheDocument();
    expect(screen.getByTestId('contest-menu-my-entry')).toHaveAttribute('aria-current', 'page');
  });

  it('puts the contest\'s phase and the entry\'s dates in the status callout', () => {
    drawEntryFrame(ContestEntryStatus.SUBMITTED);

    fireEvent.click(screen.getByTestId('contest-entry-status'));

    expect(screen.getByTestId('contest-entry-status-entry-status')).toHaveTextContent('Submitted');
    expect(screen.getByTestId('contest-entry-status-contest-phase')).toHaveTextContent('Open until the first game');
    expect(screen.getByTestId('contest-entry-status-created')).toHaveTextContent('2026');
    expect(screen.getByTestId('contest-entry-status-last-updated')).toHaveTextContent('2026');
  });
});
