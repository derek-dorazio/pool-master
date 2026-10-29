import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { buildContest, buildContestEntry } from '@/features/contests/test/contest-admin-fixtures';
import { OtherContestsCard } from './league-home-cards';

const live = buildContest({ id: 'contest-live', name: 'Masters Tiers', status: ContestStatus.ACTIVE });
const open = buildContest({ id: 'contest-open', name: 'PGA Championship Budget', status: ContestStatus.OPEN });

function drawCard() {
  render(
    <MemoryRouter>
      <OtherContestsCard
        contests={[live, open]}
        entriesByContestId={new Map([[open.id, [buildContestEntry({ contestId: open.id })]]])}
        entriesState="ready"
        hasTeam
        leagueCode="BIGDAWGS"
      />
    </MemoryRouter>,
  );
}

describe('OtherContestsCard', () => {
  it('opens a live contest on its leaderboard, the whole row being the link', () => {
    drawCard();

    expect(screen.getByTestId('league-home-contest-contest-live')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-live/leaderboard');
    expect(screen.getByRole('link', { name: /Masters Tiers/ })).toBe(screen.getByTestId('league-home-contest-contest-live'));
  });

  it('opens an open contest on its contest page', () => {
    drawCard();

    expect(screen.getByTestId('league-home-contest-contest-open')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-open');
  });

  it('offers no separate View or Leaderboard button beside a row', () => {
    drawCard();

    const card = screen.getByTestId('league-home-other-contests');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: /^(View|Leaderboard)$/i })).not.toBeInTheDocument();
  });

  it('says whether the viewer\'s team has an entry in each contest', () => {
    drawCard();

    expect(screen.getByTestId('league-home-contest-contest-open')).toHaveTextContent('You have an entry');
    expect(screen.getByTestId('league-home-contest-contest-live')).toHaveTextContent('You haven’t entered');
  });
});
