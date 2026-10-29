import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import type { ContestDto } from '@/lib/api';
import { ContestEntryBackLinks, ContestEntryFrame, ContestPageFrame } from './contest-header';
import { entryPageView, type ContestView } from './contest-page-view';

const contest = { id: 'contest-1', myEntryIds: ['entry-1'], name: 'Masters Pool', status: ContestStatus.ACTIVE } as ContestDto;

function renderFrame({
  current = 'entries',
  leagueCode = 'BIGDAWGS',
  myEntryIds = contest.myEntryIds,
  picksRevealed = true,
  title,
}: {
  current?: ContestView | null;
  leagueCode?: string | null;
  myEntryIds?: string[];
  picksRevealed?: boolean;
  title?: string;
} = {}) {
  render(
    <MemoryRouter>
      <ContestPageFrame
        contest={{ ...contest, myEntryIds }}
        current={current}
        leagueCode={leagueCode}
        picksRevealed={picksRevealed}
        testId="frame"
        title={title}
        titleTestId="frame-heading"
      >
        <p>Page body</p>
      </ContestPageFrame>
    </MemoryRouter>,
  );
}

describe('ContestPageFrame', () => {
  it('heads the page with the contest name and its status badge, with the body underneath', () => {
    renderFrame();

    expect(screen.getByTestId('frame-heading')).toHaveTextContent('Masters Pool');
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByTestId('frame')).toHaveTextContent('Page body');
  });

  it('heads the page with its own title when it is about one entry', () => {
    renderFrame({ title: 'Casey Crushers 1' });

    expect(screen.getByTestId('frame-heading')).toHaveTextContent('Casey Crushers 1');
  });

  it('offers Entries, Leaderboard and My entry once picks are revealed and the viewer has an entry, on the current page', () => {
    renderFrame({ current: 'leaderboard' });

    expect(screen.getByTestId('contest-menu-entries')).not.toBeChecked();
    expect(screen.getByTestId('contest-menu-leaderboard')).toBeChecked();
    expect(screen.getByTestId('contest-menu-my-entry')).toBeInTheDocument();
  });

  it('leaves out My entry when the viewer has no entry in the contest', () => {
    renderFrame({ myEntryIds: [] });

    expect(screen.getByTestId('contest-menu-leaderboard')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-menu-my-entry')).not.toBeInTheDocument();
  });

  it('leaves out Leaderboard until picks are revealed, since its read is refused before then', () => {
    renderFrame({ picksRevealed: false });

    expect(screen.getByTestId('contest-menu-entries')).toBeChecked();
    expect(screen.queryByTestId('contest-menu-leaderboard')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-menu-my-entry')).toBeInTheDocument();
  });

  it('shows no sub-menu while the league is unknown, since every option is a league path', () => {
    renderFrame({ leagueCode: null });

    expect(screen.queryByTestId('contest-menu')).not.toBeInTheDocument();
  });

  it('selects no option on another team\'s entry page', () => {
    renderFrame({ current: null });

    expect(screen.getByTestId('contest-menu-entries')).not.toBeChecked();
    expect(screen.getByTestId('contest-menu-my-entry')).not.toBeChecked();
  });
});

describe('entryPageView', () => {
  it('names the viewer\'s own entry page My entry and another team\'s entry page nothing', () => {
    expect(entryPageView(contest, 'entry-1')).toBe('my-entry');
    expect(entryPageView(contest, 'entry-9')).toBeNull();
    expect(entryPageView({ myEntryIds: undefined }, 'entry-1')).toBeNull();
  });
});

describe('ContestEntryBackLinks', () => {
  it('goes back to the league alone when the league is known, the sub-menu being the way to the contest', () => {
    render(<MemoryRouter><ContestEntryBackLinks contestId="contest-1" leagueCode="BIGDAWGS" /></MemoryRouter>);

    expect(screen.getByTestId('contest-entry-back-to-league')).toHaveAttribute('href', '/league/BIGDAWGS');
    expect(screen.queryByTestId('contest-entry-back-to-contest')).not.toBeInTheDocument();
  });

  it('goes back to the contest and to the welcome page while the league is unknown', () => {
    render(<MemoryRouter><ContestEntryBackLinks contestId="contest-1" leagueCode={null} /></MemoryRouter>);

    expect(screen.getByTestId('contest-entry-back-to-contest')).toHaveAttribute('href', '/contests/contest-1');
    expect(screen.getByTestId('contest-entry-back-to-league')).toHaveAttribute('href', '/welcome');
  });
});

describe('ContestEntryFrame', () => {
  const entry = { createdAt: '2026-10-20T15:00:00.000Z', entryNumber: 2, squadName: 'Birdie Hunters', updatedAt: '2026-10-29T15:00:00.000Z' };

  function drawEntryFrame(status: ContestEntryStatus | null = ContestEntryStatus.DRAFT) {
    render(
      <MemoryRouter>
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
        </ContestEntryFrame>
      </MemoryRouter>,
    );
  }

  it('heads an entry page with the entry\'s name, its status icon instead of badges, and the contest, rules and squad in one line', () => {
    drawEntryFrame();

    expect(screen.getByTestId('contest-entry-heading')).toHaveTextContent('Birdie Hunters 2');
    expect(screen.getByTestId('contest-entry-status')).toHaveAccessibleName('Entry status: Not submitted');
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-summary')).toHaveTextContent('Masters Pool · Confidence · Birdie Hunters · Entry 2');
    expect(screen.getByText('The picks')).toBeInTheDocument();
    expect(screen.getByTestId('contest-menu-my-entry')).toBeChecked();
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
