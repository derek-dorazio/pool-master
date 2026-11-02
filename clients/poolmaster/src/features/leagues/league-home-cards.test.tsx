import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { buildContest, buildContestEntry } from '@/features/contests/test/contest-admin-fixtures';
import { LiveAndOpenCard } from './league-home-cards';

const live = buildContest({ id: 'contest-live', name: 'Masters Tiers', status: ContestStatus.ACTIVE });
const open = buildContest({ id: 'contest-open', name: 'PGA Championship Budget', status: ContestStatus.OPEN });
const draft = buildContest({ id: 'contest-draft', name: 'US Open Draft', status: ContestStatus.DRAFT });

function drawCard(contests = [live, open]) {
  render(
    <MemoryRouter>
      <LiveAndOpenCard
        contests={contests}
        entriesByContestId={new Map([[open.id, [buildContestEntry({ contestId: open.id })]]])}
        entriesState="ready"
        hasTeam
        leagueCode="BIGDAWGS"
      />
    </MemoryRouter>,
  );
}

describe('LiveAndOpenCard', () => {
  it('is titled Live and open and links to every contest', () => {
    drawCard();

    expect(within(screen.getByTestId('league-home-live-and-open')).getByRole('heading', { name: 'Live and open' })).toBeInTheDocument();
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

    const card = screen.getByTestId('league-home-live-and-open');
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

  it('says so when no other contest is open or live', () => {
    drawCard([]);

    expect(screen.getByTestId('league-home-contest-empty')).toHaveTextContent('No other contests are open or live right now.');
  });
});
