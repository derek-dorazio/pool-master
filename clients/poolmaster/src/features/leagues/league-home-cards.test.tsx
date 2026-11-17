import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import type { ContestDto } from '@/lib/api';
import { buildContest } from '@/features/contests/test/contest-admin-fixtures';
import { MoreContestsCard } from './league-home-cards';

const open = buildContest({ id: 'contest-open', name: 'PGA Championship Budget', status: ContestStatus.OPEN });

function drawCard({ contests = [open], hasHeroes }: { contests?: ContestDto[]; hasHeroes: boolean }) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <MoreContestsCard
          canExpand={false}
          contests={contests}
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
});
