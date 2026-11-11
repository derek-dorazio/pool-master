import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ContestStatus } from '@poolmaster/shared/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContestDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { buildContest, buildContestEntry } from '@/features/contests/test/contest-admin-fixtures';
import { CurrentContestsCard, LiveStandingsCard } from './league-home-cards';

const getContestLeaderboardMock = vi.fn();
bindApiMocks({ getContestLeaderboard: getContestLeaderboardMock });
afterEach(() => getContestLeaderboardMock.mockReset());

const live = buildContest({ id: 'contest-live', name: 'Masters Tiers', status: ContestStatus.ACTIVE });
const open = buildContest({ id: 'contest-open', name: 'PGA Championship Budget', status: ContestStatus.OPEN });
const draft = buildContest({ id: 'contest-draft', name: 'US Open Draft', status: ContestStatus.DRAFT });

function drawCard(contests = [live, open]) {
  render(
    <MemoryRouter>
      <CurrentContestsCard
        contests={contests}
        emptyBody="No other open or live contests."
        entriesByContestId={new Map([[open.id, [buildContestEntry({ contestId: open.id })]]])}
        entriesState="ready"
        hasTeam
        leagueCode="BIGDAWGS"
      />
    </MemoryRouter>,
  );
}

describe('CurrentContestsCard', () => {
  it('is titled Current contests and its footer link, not a button, goes to every contest', () => {
    drawCard();

    expect(within(screen.getByTestId('league-home-current-contests')).getByRole('heading', { name: 'Current contests' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All contests/ })).toBe(screen.getByTestId('league-home-all-contests'));
    expect(screen.getByTestId('league-home-all-contests')).toHaveAttribute('href', '/league/BIGDAWGS/contests');
  });

  it('opens a live contest on its leaderboard, the whole row being the link', () => {
    drawCard();

    expect(screen.getByTestId('league-home-contest-contest-live')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-live/leaderboard');
    expect(screen.getByRole('link', { name: /Masters Tiers/ })).toBe(screen.getByTestId('league-home-contest-contest-live'));
  });

  it('opens an open contest on its Entries page', () => {
    drawCard();

    expect(screen.getByTestId('league-home-contest-contest-open')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-open');
  });

  it('offers no separate View or Leaderboard button beside a row', () => {
    drawCard();

    const card = screen.getByTestId('league-home-current-contests');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: /^(View|Leaderboard)$/i })).not.toBeInTheDocument();
  });

  it('describes the viewer\'s entry in each contest in the shared wording', () => {
    drawCard();

    expect(screen.getByTestId('league-home-contest-contest-open')).toHaveTextContent('Your entry is submitted.');
    expect(screen.getByTestId('league-home-contest-contest-live')).toHaveTextContent('You have not entered yet.');
  });

  it('never shows a draft, even to a commissioner, because Home is about live and open contests', () => {
    drawCard([live, open, draft]);

    expect(screen.queryByTestId('league-home-contest-contest-draft')).not.toBeInTheDocument();
  });

  it('says so in the one italic line it is given when no other contest is open or live', () => {
    drawCard([]);

    expect(screen.getByTestId('league-home-contest-empty')).toHaveTextContent('No other open or live contests.');
    expect(screen.getByTestId('league-home-contest-empty')).toHaveClass('italic');
  });
});

describe('LiveStandingsCard', () => {
  const masters = buildContest({ id: 'live-1', name: 'Masters Tiers', status: ContestStatus.ACTIVE });
  const nba = buildContest({ id: 'live-2', name: 'NBA Finals Stars', status: ContestStatus.ACTIVE });

  function leaderboardOf(contestId: string, entryName: string) {
    return {
      data: {
        contestId,
        sportEventId: 'event-1',
        sport: 'GOLF',
        scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
        countingRule: { type: 'BEST_N', count: 4 },
        participants: [],
        asOf: null,
        entries: [{
          entryId: `entry-${contestId}`, entryName, entryNumber: 1, squadId: `squad-${contestId}`, squadName: `${entryName}'s team`,
          position: 1, displayPosition: '1', countingPickLimit: 4, scoredPickCount: 4, totalScore: -5,
          events: [{ sportEventId: 'event-1', totalScore: -5, position: 1, displayPosition: '1' }], picks: [],
        }],
      },
    };
  }

  it('falls back to the first live contest when the chosen one goes final and leaves the list', async () => {
    getContestLeaderboardMock.mockImplementation(({ path }: { path: { contestId: string } }) =>
      leaderboardOf(path.contestId, path.contestId === 'live-1' ? 'Bogey Men' : 'Net Gains'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const draw = (contests: ContestDto[]) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LiveStandingsCard contests={contests} leagueCode="BIGDAWGS" mySquadId={null} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(draw([masters, nba]));
    fireEvent.click(screen.getByRole('radio', { name: 'NBA Finals Stars' }));
    expect(await screen.findByText('Net Gains')).toBeInTheDocument();

    rerender(draw([masters]));

    const card = within(screen.getByTestId('league-home-live-standings'));
    expect(await card.findByText('Bogey Men')).toBeInTheDocument();
    expect(card.getByRole('heading', { name: 'Masters Tiers · Top 5' })).toBeInTheDocument();
    expect(card.getByRole('link', { name: /Full leaderboard/ })).toHaveAttribute('href', '/league/BIGDAWGS/contests/live-1/leaderboard');
    expect(card.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('keeps the first chip chosen when the chosen contest leaves but two are still live', async () => {
    const pga = buildContest({ id: 'live-3', name: 'PGA Budget', status: ContestStatus.ACTIVE });
    getContestLeaderboardMock.mockImplementation(({ path }: { path: { contestId: string } }) =>
      leaderboardOf(path.contestId, { 'live-1': 'Bogey Men', 'live-2': 'Net Gains', 'live-3': 'Sand Trappers' }[path.contestId] ?? ''));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const draw = (contests: ContestDto[]) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LiveStandingsCard contests={contests} leagueCode="BIGDAWGS" mySquadId={null} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(draw([masters, nba, pga]));
    fireEvent.click(screen.getByRole('radio', { name: 'NBA Finals Stars' }));
    expect(await screen.findByText('Net Gains')).toBeInTheDocument();

    rerender(draw([masters, pga]));

    expect(screen.getByRole('radio', { name: 'Masters Tiers' })).toBeChecked();
    expect(await screen.findByText('Bogey Men')).toBeInTheDocument();
  });
});
