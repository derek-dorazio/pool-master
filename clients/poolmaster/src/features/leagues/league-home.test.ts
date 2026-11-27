import { withCoverage } from '@/features/contests/test/covered-slots';
import { describe, expect, it } from 'vitest';
import type { ContestDto, ContestLeaderboardResponse } from '@/lib/api';
import { buildBracketTopStandings, buildTopStandings, describeLiveProgress, splitHomeContests } from './league-home';
import { bracketLeaderboardFixture } from '@/features/contests/test/bracket-fixtures';

type LeaderboardEntry = ContestLeaderboardResponse['entries'][number];

function contestFixture(overrides: Partial<ContestDto> & { id: string }): ContestDto {
  return withCoverage({
    name: `Contest ${overrides.id}`,
    status: 'OPEN',
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    leagueId: 'league-1',
    entriesPerContest: null,
    sportEvents: [],
    ...overrides,
  });
}

/** A listed contest whose event starts at `startDate`, as the contest list carries it. */
function onEvent(id: string, startDate: string, overrides: Partial<ContestDto> = {}): ContestDto {
  return contestFixture({
    id,
    sportEvents: [{ sportEventId: `event-${id}`, name: `Event ${id}`, startDate, endDate: null, status: 'SCHEDULED', participantType: 'INDIVIDUAL', scoringFamily: 'STROKE_PLAY' }],
    ...overrides,
  });
}

function entryFixture(index: number, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    entryId: `entry-${index}`,
    entryName: `Entry ${index}`,
    entryNumber: 1,
    squadId: `squad-${index}`,
    squadName: `Squad ${index}`,
    position: index,
    displayPosition: String(index),
    countingPickLimit: 4,
    scoredPickCount: 4,
    totalScore: index - 6,
    events: [],
    picks: [],
    ...overrides,
  };
}

function leaderboardFixture(entries: LeaderboardEntry[]): ContestLeaderboardResponse {
  return {
    contestId: 'contest-1',
    sportEventId: 'event-1',
    sport: 'GOLF',
    participantType: 'INDIVIDUAL',
    scoringFamily: 'STROKE_PLAY',
    scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    countingRule: { type: 'BEST_N', count: 4, pickCount: 6 },
    upsetBonus: false,
    participants: [],
    entries,
    asOf: null,
  };
}

function entries(count: number): LeaderboardEntry[] {
  return Array.from({ length: count }, (_, offset) => entryFixture(offset + 1));
}

const NOW = new Date('2026-04-15T12:00:00.000Z');

describe('splitHomeContests', () => {
  const live = onEvent('live', '2026-04-10T12:00:00.000Z', { status: 'ACTIVE' });
  const openLater = onEvent('open-later', '2026-05-20T12:00:00.000Z');
  const openSoon = onEvent('open-soon', '2026-04-20T12:00:00.000Z');
  const openThird = onEvent('open-third', '2026-04-25T12:00:00.000Z');
  const full = onEvent('full', '2026-04-18T12:00:00.000Z', { entriesPerContest: 4, entryCount: 4 });
  const draft = onEvent('draft', '2026-06-01T12:00:00.000Z', { status: 'DRAFT' });

  it('draws live contests first, then open ones soonest closing, at most three, and lists the rest under More contests', () => {
    const { heroes, more } = splitHomeContests([openLater, draft, openSoon, live, openThird], { now: NOW, showDrafts: true });

    expect(heroes.map((contest) => contest.id)).toEqual(['live', 'open-soon', 'open-third']);
    expect(more.map((contest) => contest.id)).toEqual(['open-later', 'draft']);
  });

  it('leaves a full contest out of the heroes, so it shows as Full in More contests', () => {
    const { heroes, more } = splitHomeContests([full, openSoon], { now: NOW, showDrafts: false });

    expect(heroes.map((contest) => contest.id)).toEqual(['open-soon']);
    expect(more.map((contest) => contest.id)).toEqual(['full']);
  });

  it('treats a contest full only of drafts as full, from the list\'s count of every entry', () => {
    const fullOfDrafts = onEvent('drafts', '2026-04-18T12:00:00.000Z', { entriesPerContest: 4, entryCount: 1, allEntryCount: 4 });
    const { heroes, more } = splitHomeContests([fullOfDrafts, openSoon], { now: NOW, showDrafts: false });

    expect(heroes.map((contest) => contest.id)).toEqual(['open-soon']);
    expect(more.map((contest) => contest.id)).toEqual(['drafts']);
  });

  it('makes no hero of an open contest whose entries have closed before it went live', () => {
    const closed = onEvent('closed', '2026-04-14T12:00:00.000Z');

    expect(splitHomeContests([closed], { now: NOW, showDrafts: false }).heroes).toEqual([]);
  });

  it('keeps set-up contests out of More contests for a member', () => {
    expect(splitHomeContests([draft], { now: NOW, showDrafts: false }).more).toEqual([]);
  });
});

describe('describeLiveProgress', () => {
  it('words the list\'s progress in its unit: games, weeks or events played', () => {
    expect(describeLiveProgress({ progress: { played: 9, total: 14, unit: 'GAMES' } }, 'en-US')).toBe('9 of 14 games played');
    expect(describeLiveProgress({ progress: { played: 11, total: 18, unit: 'WEEKS' } }, 'en-US')).toBe('11 of 18 weeks played');
    expect(describeLiveProgress({ progress: { played: 1, total: 2, unit: 'EVENTS' } }, 'en-US')).toBe('1 of 2 events played');
  });

  it('says nothing where the list gives no progress', () => {
    expect(describeLiveProgress({ progress: null }, 'en-US')).toBeNull();
    expect(describeLiveProgress({}, 'en-US')).toBeNull();
  });
});

describe('buildTopStandings', () => {
  it('returns the top three entries in the server order with formatted totals, as a live hero shows them', () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), null);

    expect(result.rows.map((row) => row.entryId)).toEqual([
      'entry-1',
      'entry-2',
      'entry-3',
    ]);
    expect(result.rows[0]).toEqual({
      entryId: 'entry-1',
      isMine: false,
      name: 'Entry 1',
      position: '1',
      squadId: 'squad-1',
      total: '-5',
    });
    expect(result.rows[2]?.total).toBe('-3');
  });

  it('labels each row with its entry name, so two entries from one team stay distinct', () => {
    const sameTeam = [
      entryFixture(1, { entryName: 'Birdie Bandits 1', squadId: 'squad-1', squadName: 'Birdie Bandits' }),
      entryFixture(2, { entryName: 'Birdie Bandits 2', squadId: 'squad-1', squadName: 'Birdie Bandits' }),
    ];

    const result = buildTopStandings(leaderboardFixture(sameTeam), null);

    expect(result.rows.map((row) => row.name)).toEqual(['Birdie Bandits 1', 'Birdie Bandits 2']);
  });

  it('does not re-sort entries the server ranked', () => {
    const ranked = [entryFixture(2), entryFixture(1), entryFixture(3)];

    const result = buildTopStandings(leaderboardFixture(ranked), null);

    expect(result.rows.map((row) => row.entryId)).toEqual(['entry-2', 'entry-1', 'entry-3']);
  });

  it("marks the viewer's squad in the top rows and returns no rows below", () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), 'squad-3');

    expect(result.rows.filter((row) => row.isMine).map((row) => row.entryId)).toEqual(['entry-3']);
    expect(result.myRowsBelow).toEqual([]);
  });

  it("returns the viewer's entry in myRowsBelow when it ranks below the top rows", () => {
    const result = buildTopStandings(leaderboardFixture(entries(8)), 'squad-7');

    expect(result.rows.some((row) => row.isMine)).toBe(false);
    expect(result.myRowsBelow).toEqual([{
      entryId: 'entry-7',
      isMine: true,
      name: 'Entry 7',
      position: '7',
      squadId: 'squad-7',
      total: '+1',
    }]);
  });

  it("returns every one of the viewer's entries below the top rows, so two entries both show", () => {
    const mine = [
      ...entries(5),
      entryFixture(6, { squadId: 'squad-mine' }),
      entryFixture(7),
      entryFixture(8, { squadId: 'squad-mine' }),
    ];

    const result = buildTopStandings(leaderboardFixture(mine), 'squad-mine');

    expect(result.myRowsBelow.map((row) => row.entryId)).toEqual(['entry-6', 'entry-8']);
  });

  it('returns no row below when the viewer has no entry on the leaderboard', () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), 'squad-unknown');

    expect(result.rows.some((row) => row.isMine)).toBe(false);
    expect(result.myRowsBelow).toEqual([]);
  });

  it('marks nothing as mine when the viewer has no squad', () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), null);

    expect(result.rows.some((row) => row.isMine)).toBe(false);
    expect(result.myRowsBelow).toEqual([]);
  });

  it('places every entry tied 1st at even par (E) before the first score, as the contest board does', () => {
    const result = buildTopStandings(
      leaderboardFixture([
        entryFixture(1, { totalScore: null, displayPosition: null }),
        entryFixture(2, { totalScore: null, displayPosition: null }),
      ]),
      null,
    );

    expect(result.rows.map((row) => [row.position, row.total])).toEqual([['T1', 'E'], ['T1', 'E']]);
  });

  it('shows a null total for an unscored entry once others have scored', () => {
    const result = buildTopStandings(
      leaderboardFixture([entryFixture(1), entryFixture(2, { totalScore: null, displayPosition: null })]),
      null,
    );

    expect(result.rows[1]).toMatchObject({ position: null, total: null });
  });

  it('honours a custom limit', () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), 'squad-6', 5);

    expect(result.rows).toHaveLength(5);
    expect(result.myRowsBelow.map((row) => row.entryId)).toEqual(['entry-6']);
  });
});

describe('buildBracketTopStandings', () => {
  it('lists a bracket contest\'s entries by entry name in the server\'s order with their points, marking the viewer\'s team', () => {
    const result = buildBracketTopStandings(bracketLeaderboardFixture(), 'squad-1');

    expect(result.rows).toEqual([
      { entryId: 'entry-2', isMine: false, name: 'Chalk All The Way', position: '1', squadId: 'squad-2', total: '12' },
      { entryId: 'entry-1', isMine: true, name: 'Derek’s Bracket', position: '2', squadId: 'squad-1', total: '8' },
    ]);
    expect(result.myRowsBelow).toEqual([]);
  });
});
