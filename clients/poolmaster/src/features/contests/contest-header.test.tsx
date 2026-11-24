import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContestDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryFrame, ContestPageFrame } from './contest-header';

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
  sportEvents: [] as ContestDto['sportEvents'],
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
  entryName,
  leagueCode = 'BIGDAWGS',
  title,
  url,
}: {
  contestOverrides?: Partial<ContestDto>;
  entryName?: string;
  leagueCode?: string;
  title?: string;
  url?: string;
} = {}) {
  renderAt(
    <ContestPageFrame
      contest={{ ...contest, ...contestOverrides }}
      entryName={entryName}
      leagueCode={leagueCode}
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

  it('carries no Leaderboard / Entries / My entry tabs: the contest has one page whose view follows its stage', () => {
    renderFrame();

    expect(screen.queryByRole('navigation', { name: 'Contest pages' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-menu-entries')).not.toBeInTheDocument();
  });
});

describe('The contest breadcrumb', () => {
  it('trails Home then the contest\'s name on a live contest\'s page, Home focused on the contest', () => {
    renderFrame();

    expect(breadcrumbs().getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/league/BIGDAWGS?focus=contest-1');
    expect(breadcrumbs().getByText('Masters Pool')).toHaveAttribute('aria-current', 'page');
  });

  it('trails My team from a final contest, opening its Past contests at the year the contest ended, focused on it', () => {
    renderFrame({ contestOverrides: { status: ContestStatus.COMPLETED } });

    expect(breadcrumbs().getByRole('link', { name: 'My team' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/team?past=all&pastYear=2026&focus=contest-1',
    );
  });

  it('trails Home, the contest and the entry on an entry page, the contest opening its one page', () => {
    renderFrame({ entryName: 'Birdie Hunters 2', url: '/league/BIGDAWGS/contests/contest-1/entries/entry-9' });

    expect(breadcrumbs().getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/league/BIGDAWGS?focus=contest-1');
    expect(breadcrumbs().getByRole('link', { name: 'Masters Pool' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1');
    expect(breadcrumbs().getByText('Birdie Hunters 2')).toHaveAttribute('aria-current', 'page');
  });

  it('shows no Back to league button, the breadcrumb being the way back', () => {
    renderFrame({ entryName: 'Birdie Hunters 2' });

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
  const entry = { createdAt: '2026-10-20T15:00:00.000Z', updatedAt: '2026-10-29T15:00:00.000Z' };

  function drawEntryFrame(status: ContestEntryStatus | null = ContestEntryStatus.DRAFT) {
    renderAt(
        <ContestEntryFrame
          contest={contest}
          entry={entry}
          leagueCode="BIGDAWGS"
          phaseLabel="Open until the first game"
          rules={['Confidence']}
          status={status}
          statusLine="Not submitted · submit by Thu 8:15 PM"
          title="Birdie Hunters 2"
        >
          <p>The picks</p>
        </ContestEntryFrame>,
      '/league/BIGDAWGS/contests/contest-1/entries/entry-1',
    );
  }

  it('heads an entry page with the entry\'s name, its status icon instead of badges, and where the entry stands in one line under the name', () => {
    drawEntryFrame();

    expect(screen.getByTestId('contest-entry-header-name')).toHaveTextContent('Birdie Hunters 2');
    expect(screen.getByTestId('contest-entry-status')).toHaveAccessibleName('Entry status: Not submitted');
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-entry-header-status-slot')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-status-line')).toHaveTextContent(/^Not submitted · submit by Thu 8:15 PM$/);
    expect(screen.getByText('The picks')).toBeInTheDocument();
  });

  it('leads the status peek with the status and the contest\'s phase, not the entry\'s name again, then the contest\'s rules and the entry\'s dates', () => {
    drawEntryFrame(ContestEntryStatus.SUBMITTED);

    fireEvent.click(screen.getByTestId('contest-entry-status'));

    expect(screen.getByTestId('contest-entry-status-callout')).not.toHaveTextContent('Birdie Hunters 2');

    expect(screen.getByTestId('contest-entry-status-entry-status')).toHaveTextContent('Submitted');
    expect(screen.getByTestId('contest-entry-status-contest-phase')).toHaveTextContent('Open until the first game');
    expect(screen.getByTestId('contest-entry-status-rules')).toHaveTextContent('Confidence');
    expect(screen.getByTestId('contest-entry-status-created')).toHaveTextContent('2026');
    expect(screen.getByTestId('contest-entry-status-last-updated')).toHaveTextContent('2026');
  });
});

describe('ContestPageFrame schedule notice', () => {
  it('says under the header, in one line, when an event is postponed and that a cancelled one scores nothing', async () => {
    renderFrame({ contestOverrides: {
      sportEvents: [
        { endDate: null, name: 'BUF @ KC', participantType: null, scoringFamily: null, sequence: 1, sportEventId: 'e1', startDate: '2026-11-25T01:15:00.000Z', status: 'POSTPONED' },
        { endDate: null, name: 'SEA @ SF', participantType: null, scoringFamily: null, sequence: 2, sportEventId: 'e2', startDate: '2026-11-25T21:00:00.000Z', status: 'CANCELLED' },
      ],
    } });

    expect(await screen.findByTestId('contest-schedule-notice')).toHaveTextContent(/^BUF @ KC postponed to .+\. SEA @ SF cancelled: no points\.$/);
  });

  it('shows no notice while every event is on schedule', async () => {
    renderFrame();

    await screen.findByTestId('frame-header-name');
    expect(screen.queryByTestId('contest-schedule-notice')).not.toBeInTheDocument();
  });
});

