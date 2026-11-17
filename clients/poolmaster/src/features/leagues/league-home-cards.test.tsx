import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import type { ContestDto, ContestResultSummaryDto } from '@/lib/api';
import { buildContestResult } from '@/features/championships/test/fixtures';
import { buildContest } from '@/features/contests/test/contest-admin-fixtures';
import { MoreContestsCard } from './league-home-cards';

const open = buildContest({ id: 'contest-open', name: 'PGA Championship Budget', status: ContestStatus.OPEN });

function drawCard({ contests = [open], finals = [], hasHeroes }: { contests?: ContestDto[]; finals?: ContestResultSummaryDto[]; hasHeroes: boolean }) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <MoreContestsCard
          canExpand={false}
          contests={contests}
          finals={finals}
          focusContestId={null}
          hasHeroes={hasHeroes}
          hasTeam
          leagueCode="BIGDAWGS"
          myEntries={{ bestPlaceByContestId: new Map(), entriesByContestId: new Map(), isError: false, isLoading: false, placeByEntryId: new Map(), state: 'ready' }}
          now={new Date('2026-04-01T12:00:00.000Z')}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MoreContestsCard', () => {
  it('is titled More contests under the heroes, and has no footer link to a contests page', () => {
    drawCard({ hasHeroes: true });

    const card = within(screen.getByTestId('league-home-more-contests'));
    expect(card.getByRole('heading', { name: 'More contests' })).toBeInTheDocument();
    expect(card.queryByRole('link', { name: /All contests/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('league-home-contest-contest-open')).toBeInTheDocument();
  });

  it('is titled Contests, with one italic line, when there are no heroes and nothing else to list', () => {
    drawCard({ contests: [], hasHeroes: false });

    expect(within(screen.getByTestId('league-home-more-contests')).getByRole('heading', { name: 'Contests' })).toBeInTheDocument();
    expect(screen.getByTestId('league-home-contest-empty')).toHaveTextContent('No open or live contests.');
  });

  it('lists the contests gone final lately after the current ones, with the team\'s finish, each opening its page', () => {
    drawCard({
      finals: [
        buildContestResult({ contestId: 'week-11', name: 'Week 11 Pick\'em', rankedEntryCount: 14, squadFinish: { displayPlace: '5', place: 5, points: 0 } }),
        buildContestResult({ contestId: 'masters', name: 'Masters Tiered', rankedEntryCount: 9, squadFinish: null }),
      ],
      hasHeroes: true,
    });

    expect(screen.getByTestId('league-home-contest-contest-open')).toBeInTheDocument();
    expect(screen.getByTestId('league-home-final-week-11')).toHaveTextContent('Final · you were 5th of 14');
    expect(screen.getByTestId('league-home-final-week-11')).toHaveAttribute('href', '/league/BIGDAWGS/contests/week-11');
    expect(screen.getByTestId('league-home-final-masters')).toHaveTextContent('Final · 9 entries');
  });

  it('drops the empty line when only contests gone final lately are left to list', () => {
    drawCard({ contests: [], finals: [buildContestResult({ contestId: 'week-11', rankedEntryCount: 14 })], hasHeroes: true });

    expect(screen.queryByTestId('league-home-contest-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('league-home-final-week-11')).toBeInTheDocument();
  });
});
