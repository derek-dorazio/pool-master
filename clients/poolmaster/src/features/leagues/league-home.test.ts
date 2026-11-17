import { describe, expect, it } from 'vitest';
import type { ContestDto, ContestLeaderboardResponse } from '@/lib/api';
import { buildBracketTopStandings, buildTopStandings, orderLiveStandings } from './league-home';
import { bracketLeaderboardFixture } from '@/features/contests/test/bracket-fixtures';

type LeaderboardEntry = ContestLeaderboardResponse['entries'][number];

function contestFixture(overrides: Partial<ContestDto> & { id: string }): ContestDto {
  return {
    name: `Contest ${overrides.id}`,
    status: 'OPEN',
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    leagueId: 'league-1',
    entriesPerContest: null,
    sportEvents: [],
    ...overrides,
  };
}

/** A listed contest whose event starts at `startDate`, as the contest list carries it. */
function onEvent(id: string, startDate: string, overrides: Partial<ContestDto> = {}): ContestDto {
  return contestFixture({
    id,
    sportEvents: [{ sportEventId: `event-${id}`, sequence: 1, name: `Event ${id}`, startDate, endDate: null, status: 'SCHEDULED', participantType: null, scoringFamily: null }],
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
    participantType: null,
    scoringFamily: null,
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

describe('orderLiveStandings', () => {
  it('puts the live contests the viewer is in first, then the rest, each by start', () => {
    const notMineSoon = onEvent('not-mine-soon', '2026-04-20T12:00:00.000Z', { status: 'ACTIVE' });
    const mineLate = onEvent('mine-late', '2026-04-28T12:00:00.000Z', { status: 'ACTIVE' });
    const mineEarly = onEvent('mine-early', '2026-04-25T12:00:00.000Z', { status: 'ACTIVE' });
    const notMineLate = onEvent('not-mine-late', '2026-04-29T12:00:00.000Z', { status: 'ACTIVE' });

    const ordered = orderLiveStandings([notMineLate, mineLate, notMineSoon, mineEarly], new Set(['mine-late', 'mine-early']));

    expect(ordered.map((contest) => contest.id)).toEqual(['mine-early', 'mine-late', 'not-mine-soon', 'not-mine-late']);
  });

  it('orders by start alone when the viewer is in none of them', () => {
    const later = onEvent('later', '2026-04-28T12:00:00.000Z', { status: 'ACTIVE' });
    const sooner = onEvent('sooner', '2026-04-20T12:00:00.000Z', { status: 'ACTIVE' });

    expect(orderLiveStandings([later, sooner], new Set()).map((contest) => contest.id)).toEqual(['sooner', 'later']);
  });
});

describe('buildTopStandings', () => {
  it('returns the top five entries in the server order with formatted totals', () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), null);

    expect(result.rows.map((row) => row.entryId)).toEqual([
      'entry-1',
      'entry-2',
      'entry-3',
      'entry-4',
      'entry-5',
    ]);
    expect(result.rows[0]).toEqual({
      entryId: 'entry-1',
      isMine: false,
      name: 'Entry 1',
      position: '1',
      squadId: 'squad-1',
      total: '-5',
    });
    expect(result.rows[4]?.total).toBe('-1');
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

  it("marks the viewer's squad in the top rows and returns no row below", () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), 'squad-3');

    expect(result.rows.filter((row) => row.isMine).map((row) => row.entryId)).toEqual(['entry-3']);
    expect(result.myRowBelow).toBeNull();
  });

  it("returns the viewer's entry as myRowBelow when it ranks below the top rows", () => {
    const result = buildTopStandings(leaderboardFixture(entries(8)), 'squad-7');

    expect(result.rows.some((row) => row.isMine)).toBe(false);
    expect(result.myRowBelow).toEqual({
      entryId: 'entry-7',
      isMine: true,
      name: 'Entry 7',
      position: '7',
      squadId: 'squad-7',
      total: '+1',
    });
  });

  it('returns no row below when the viewer has no entry on the leaderboard', () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), 'squad-unknown');

    expect(result.rows.some((row) => row.isMine)).toBe(false);
    expect(result.myRowBelow).toBeNull();
  });

  it('marks nothing as mine when the viewer has no squad', () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), null);

    expect(result.rows.some((row) => row.isMine)).toBe(false);
    expect(result.myRowBelow).toBeNull();
  });

  it('shows a null total for an entry with no scored picks yet', () => {
    const result = buildTopStandings(
      leaderboardFixture([entryFixture(1, { totalScore: null, displayPosition: null })]),
      null,
    );

    expect(result.rows[0]).toMatchObject({ position: null, total: null });
  });

  it('honours a custom limit', () => {
    const result = buildTopStandings(leaderboardFixture(entries(7)), 'squad-4', 3);

    expect(result.rows).toHaveLength(3);
    expect(result.myRowBelow?.entryId).toBe('entry-4');
  });
});

describe('buildBracketTopStandings', () => {
  it('lists a bracket contest\'s entries by entry name in the server\'s order with their points, marking the viewer\'s team', () => {
    const result = buildBracketTopStandings(bracketLeaderboardFixture(), 'squad-1');

    expect(result.rows).toEqual([
      { entryId: 'entry-2', isMine: false, name: 'Chalk All The Way', position: '1', squadId: 'squad-2', total: '12' },
      { entryId: 'entry-1', isMine: true, name: 'Derek’s Bracket', position: '2', squadId: 'squad-1', total: '8' },
    ]);
    expect(result.myRowBelow).toBeNull();
  });
});
