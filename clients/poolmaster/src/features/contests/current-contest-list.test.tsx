import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { buildContest, buildContestEntry } from './test/contest-admin-fixtures';
import { CurrentContestList } from './current-contest-list';

const live = buildContest({ id: 'live', name: 'NBA Finals Stars', status: ContestStatus.ACTIVE, entryCount: 24 });
const submitted = buildContest({ id: 'submitted', name: 'Masters Pick 6', status: ContestStatus.OPEN, entryCount: 1 });
const unsubmitted = buildContest({ id: 'unsubmitted', name: 'PGA Budget', status: ContestStatus.OPEN });
const draft = buildContest({ id: 'draft', name: 'US Open Tiers', status: ContestStatus.DRAFT });

const entries = new Map([
  [submitted.id, [buildContestEntry({ contestId: submitted.id })]],
  [unsubmitted.id, [buildContestEntry({
    contestId: unsubmitted.id,
    events: [{ sportEventId: 'event-1', status: ContestEntryStatus.DRAFT, submittedAt: null }],
  })]],
]);

function drawList(props: Partial<ComponentProps<typeof CurrentContestList>> = {}) {
  render(
    <MemoryRouter>
      <CurrentContestList
        bestPlaceByContestId={new Map()}
        contests={[draft, unsubmitted, live, submitted]}
        emptyBody="Nothing current."
        entriesByContestId={entries}
        entriesState="ready"
        hasTeam
        leagueCode="BIGDAWGS"
        showDrafts={false}
        testIdPrefix="list"
        {...props}
      />
    </MemoryRouter>,
  );
}

function rowNote(contestId: string) {
  return screen.getByTestId(`list-${contestId}`).textContent;
}

describe('CurrentContestList', () => {
  it('heads its groups Live then Open for entries, each row in its group', () => {
    drawList();

    const groups = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(groups).toEqual(['Live', 'Open for entries']);
    expect(within(screen.getByTestId('list-group-live')).getByTestId('list-live')).toBeInTheDocument();
    expect(within(screen.getByTestId('list-group-open')).getByTestId('list-submitted')).toBeInTheDocument();
  });

  it('shows drafts under their own heading to a commissioner', () => {
    drawList({ showDrafts: true });

    expect(within(screen.getByTestId('list-group-draft')).getByTestId('list-draft')).toHaveAttribute('href', '/league/BIGDAWGS/contests/draft');
  });

  it('hides drafts from a member', () => {
    drawList();

    expect(screen.queryByTestId('list-draft')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-group-draft')).not.toBeInTheDocument();
  });

  it('opens a live contest on its leaderboard and an open one on its Entries page', () => {
    drawList();

    expect(screen.getByTestId('list-live')).toHaveAttribute('href', '/league/BIGDAWGS/contests/live/leaderboard');
    expect(screen.getByTestId('list-submitted')).toHaveAttribute('href', '/league/BIGDAWGS/contests/submitted');
  });

  it('says the entry is submitted, not submitted yet, or not made', () => {
    drawList();

    expect(rowNote('submitted')).toContain('Your entry is submitted.');
    expect(rowNote('unsubmitted')).toContain('Your entry is not submitted yet.');
    expect(rowNote('live')).toContain('You have not entered yet.');
  });

  it('asks a viewer without a team to choose their name before entering', () => {
    drawList({ hasTeam: false });

    expect(rowNote('submitted')).toContain('Create your team to enter.');
  });

  it('says it is checking while the entries load', () => {
    drawList({ entriesState: 'loading' });
    expect(rowNote('submitted')).toContain('Checking your entry...');
  });

  it('says it could not check the entry when the read failed', () => {
    drawList({ entriesState: 'failed' });
    expect(rowNote('submitted')).toContain("We couldn't check your entry.");
  });

  it('shows each row\'s entry count after its kind only when asked to', () => {
    drawList({ showEntryCount: true });
    expect(screen.getByTestId('list-live')).toHaveTextContent(/Tiered\s*·\s*24 entries/);
    expect(screen.getByTestId('list-submitted')).toHaveTextContent(/Tiered\s*·\s*1 entry(?!\w*ies)/);
  });

  it('shows no entry count on a summary list', () => {
    drawList();
    expect(screen.getByTestId('list-live')).not.toHaveTextContent('entries');
  });

  it('puts no status badge on a row, because the group heading names the status', () => {
    drawList();
    expect(within(screen.getByTestId('list-live')).queryByText('Live')).not.toBeInTheDocument();
  });

  it('tints only the focused contest', () => {
    drawList({ focusContestId: 'submitted' });

    expect(screen.getByTestId('list-submitted')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('list-live')).not.toHaveAttribute('data-highlighted');
  });

  it('shows the empty message when nothing is current', () => {
    drawList({ contests: [] });

    expect(screen.getByTestId('list-empty')).toHaveTextContent('Nothing current.');
  });

  it('shows the viewer\'s best place on a live row, the place as its leaderboard reads it', () => {
    drawList({ bestPlaceByContestId: new Map([[live.id, { entryId: 'mine-1', position: 3, displayPosition: '3' }]]) });

    expect(screen.getByTestId('list-live-trailing')).toHaveTextContent(/^3rd$/);
  });

  it('shows a shared place as the leaderboard does, "T2"', () => {
    drawList({ bestPlaceByContestId: new Map([[live.id, { entryId: 'mine-1', position: 2, displayPosition: 'T2' }]]) });

    expect(screen.getByTestId('list-live-trailing')).toHaveTextContent(/^T2$/);
  });

  it('shows no place on a row the viewer has no ranked entry in', () => {
    drawList();

    expect(screen.queryByTestId('list-live-trailing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-submitted-trailing')).not.toBeInTheDocument();
  });

  it('says how many entries the viewer has in its fact line when they have more than one, after the contest\'s count', () => {
    const two = new Map([...entries, [live.id, [buildContestEntry({ contestId: live.id, id: 'mine-1' }), buildContestEntry({ contestId: live.id, id: 'mine-2', entryNumber: 2 })]]]);
    drawList({ entriesByContestId: two, showEntryCount: true });

    expect(screen.getByTestId('list-live')).toHaveTextContent(/Tiered\s*·\s*24 entries\s*·\s*Your 2 entries/);
    expect(screen.getByTestId('list-submitted')).not.toHaveTextContent(/Your \d+ entries/);
  });
});
