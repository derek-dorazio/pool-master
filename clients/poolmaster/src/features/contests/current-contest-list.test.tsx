import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { ContestEntryStatus, ContestStatus, SportEventStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import type { ContestEntryDto, ContestEntryPlaceDto } from '@/lib/api';
import { buildContest, buildContestEntry, buildContestSportEvent } from './test/contest-admin-fixtures';
import { CurrentContestList } from './current-contest-list';

const NOW = new Date('2026-04-01T12:00:00.000Z');
const CLOSES = '2026-04-10T12:00:00.000Z';
const onEvent = { sportEvents: [buildContestSportEvent({ startDate: CLOSES })] };

const notEntered = buildContest({ id: 'not-entered', name: 'NBA Finals Stars', status: ContestStatus.OPEN, entryCount: 11, ...onEvent });
const entered = buildContest({ id: 'entered', name: 'CFP Championship Stars', status: ContestStatus.OPEN, entryCount: 2, ...onEvent });
const enteredTwice = buildContest({ id: 'entered-twice', name: 'Rose Bowl Pick\'em', status: ContestStatus.OPEN, entryCount: 4, ...onEvent });
const draftEntry = buildContest({ id: 'draft-entry', name: 'PGA Budget', status: ContestStatus.OPEN, ...onEvent });
const full = buildContest({ id: 'full', name: 'Masters Tiered', status: ContestStatus.OPEN, entriesPerContest: 100, entryCount: 100, ...onEvent });
const fullAndIn = buildContest({ id: 'full-in', name: 'Daytona Budget', status: ContestStatus.OPEN, entriesPerContest: 2, entryCount: 2, ...onEvent });
const live = buildContest({ id: 'live', name: 'Week 12 Pick\'em', status: ContestStatus.ACTIVE, entryCount: 14 });
const liveNotIn = buildContest({ id: 'live-not-in', name: 'NHL Clutch Card', status: ContestStatus.ACTIVE, entryCount: 9 });
const setUp = buildContest({ id: 'set-up', name: 'Super Bowl Squares', status: ContestStatus.DRAFT, sportEvents: [buildContestSportEvent({ startDate: '2027-01-20T12:00:00.000Z' })] });

function entry(contestId: string, id = `${contestId}-1`, status: ContestEntryStatus = ContestEntryStatus.SUBMITTED): ContestEntryDto {
  return buildContestEntry({ contestId, id, events: [{ sportEventId: 'event-1', status, submittedAt: null }] });
}

const entriesByContestId = new Map<string, ContestEntryDto[]>([
  [entered.id, [entry(entered.id)]],
  [enteredTwice.id, [entry(enteredTwice.id, 'twice-1'), entry(enteredTwice.id, 'twice-2')]],
  [draftEntry.id, [entry(draftEntry.id, 'draft-1', ContestEntryStatus.DRAFT)]],
  [fullAndIn.id, [entry(fullAndIn.id)]],
  [live.id, [entry(live.id)]],
]);
const bestPlaceByContestId = new Map<string, ContestEntryPlaceDto>([[live.id, { entryId: 'live-1', position: 3, displayPosition: '3' }]]);

function drawList(props: Partial<ComponentProps<typeof CurrentContestList>> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CurrentContestList
          canExpand={false}
          contests={[notEntered, entered, enteredTwice, draftEntry, full, fullAndIn, live, liveNotIn, setUp]}
          emptyBody="Nothing current."
          hasTeam
          leagueCode="BIGDAWGS"
          myEntries={{ bestPlaceByContestId, entriesByContestId, state: 'ready' }}
          now={NOW}
          testIdPrefix="list"
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function row(contestId: string) {
  return within(screen.getByTestId(`list-${contestId}`));
}

describe('CurrentContestList', () => {
  it('lists the contests in the order it is given', () => {
    drawList({ contests: [live, notEntered, setUp] });

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Week 12 Pick\'em'),
      expect.stringContaining('NBA Finals Stars'),
      expect.stringContaining('Super Bowl Squares'),
    ]);
  });

  it('opens every row\'s contest page from the row itself: beside its buttons, or the whole row when it has none', () => {
    drawList();

    expect(screen.getByTestId('list-not-entered-link')).toHaveAttribute('href', '/league/BIGDAWGS/contests/not-entered');
    expect(screen.getByTestId('list-live')).toHaveAttribute('href', '/league/BIGDAWGS/contests/live');
  });

  it('offers Make your picks on an open contest the viewer is not in, with when it closes and how many entered', () => {
    drawList();

    expect(row('not-entered').getByRole('button', { name: 'Make your picks' })).toBeInTheDocument();
    expect(screen.getByTestId('list-not-entered-status')).toHaveTextContent(/^Open·closes .*Apr 10, 2026.*·11 entries$/);
  });

  it('offers Edit picks to the one entry\'s pick screen and Add entry once the viewer is in', () => {
    drawList();

    expect(row('entered').getByRole('link', { name: 'Edit picks' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/entered/entries/entered-1');
    expect(row('entered').getByRole('button', { name: 'Add entry' })).toBeInTheDocument();
  });

  it('sends Edit picks to the contest page, and counts the entries, when the viewer has more than one', () => {
    drawList();

    expect(row('entered-twice').getByRole('link', { name: 'Edit picks' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/entered-twice');
    expect(screen.getByTestId('list-entered-twice-status')).toHaveTextContent('Your 2 entries');
  });

  it('offers Finish your picks while the viewer\'s entry is not submitted', () => {
    drawList();

    expect(row('draft-entry').getByRole('link', { name: 'Finish your picks' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/draft-entry/entries/draft-1');
  });

  it('says Full on a full contest the viewer is not in, with Expand only for a commissioner', () => {
    drawList();
    expect(screen.getByTestId('list-full-full')).toHaveTextContent('Full');
    expect(screen.queryByTestId('list-full-expand')).not.toBeInTheDocument();
    expect(row('full').queryByRole('button')).not.toBeInTheDocument();
  });

  it('gives a commissioner Expand on a full contest, to its setup page', () => {
    drawList({ canExpand: true });

    expect(screen.getByTestId('list-full-expand')).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/full');
  });

  it('keeps Edit picks but drops Add entry on a full contest the viewer is in', () => {
    drawList();

    expect(row('full-in').getByRole('link', { name: 'Edit picks' })).toBeInTheDocument();
    expect(row('full-in').queryByRole('button', { name: 'Add entry' })).not.toBeInTheDocument();
  });

  it('shows the viewer\'s place of how many on a live contest, and no button', () => {
    drawList();

    expect(screen.getByTestId('list-live-status')).toHaveTextContent('Live·you\'re 3rd of 14');
    expect(row('live').queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows how many entries a live contest has when the viewer is not in it', () => {
    drawList();

    expect(screen.getByTestId('list-live-not-in-status')).toHaveTextContent('Live·9 entries');
  });

  it('carries the gold Postponed chip after Live when one of the contest\'s events is postponed', () => {
    const postponed = buildContest({ id: 'postponed', name: 'Week 13 Pick\'em', status: ContestStatus.ACTIVE, entryCount: 6, sportEvents: [buildContestSportEvent({ status: SportEventStatus.POSTPONED })] });
    drawList({ contests: [postponed, live] });

    expect(screen.getByTestId('list-postponed-status-schedule')).toHaveTextContent('Postponed');
    expect(screen.getByTestId('list-postponed-status')).toHaveTextContent(/^Live·Postponed·6 entries$/);
    expect(screen.queryByTestId('list-live-status-schedule')).not.toBeInTheDocument();
  });

  it('says Set up and when it starts on a set-up contest, with no action', () => {
    drawList();

    expect(screen.getByTestId('list-set-up-status')).toHaveTextContent(/^Set up·starts .*Jan 20, 2027/);
    expect(screen.queryByTestId('list-set-up-actions')).not.toBeInTheDocument();
  });

  it('asks a viewer without a team to create one instead of offering picks', () => {
    drawList({ hasTeam: false });

    expect(screen.getByTestId('list-not-entered-note')).toHaveTextContent('Create your team to enter.');
    expect(row('not-entered').queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers no picks while the viewer\'s entries are still loading, so it never starts a second entry', () => {
    drawList({ myEntries: { bestPlaceByContestId, entriesByContestId: new Map(), state: 'loading' } });

    expect(screen.getByTestId('list-entered-note')).toHaveTextContent('Checking your entry...');
    expect(row('entered').queryByRole('button')).not.toBeInTheDocument();
  });

  it('tints and scrolls to the contest the viewer came from', () => {
    drawList({ focusContestId: 'live' });

    expect(screen.getByTestId('list-live')).toHaveAttribute('data-highlighted', 'true');
  });

  it('says so in one italic line when there is nothing to list', () => {
    drawList({ contests: [] });

    expect(screen.getByTestId('list-empty')).toHaveTextContent('Nothing current.');
  });
});
