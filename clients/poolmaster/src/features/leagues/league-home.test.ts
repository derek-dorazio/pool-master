import { describe, expect, it } from 'vitest';
import type { ContestDto, ContestLeaderboardResponse } from '@/lib/api';
import type { ContestSchedule } from '@/features/contests/use-contest-schedule';
import { buildTopStandings, countdownUntil, pickUpNextContest } from './league-home';

type LeaderboardEntry = ContestLeaderboardResponse['entries'][number];

const NOW = new Date('2026-05-01T12:00:00.000Z');

function contestFixture(overrides: Partial<ContestDto> & { id: string }): ContestDto {
  return {
    name: `Contest ${overrides.id}`,
    status: 'OPEN',
    contestFormat: 'ROSTER',
    selectionType: 'OPEN_SELECTION',
    scoringEngine: 'STROKE_PLAY',
    leagueId: 'league-1',
    isExclusive: false,
    ...overrides,
  };
}

function schedule(startsAt: string): ContestSchedule {
  return { startsAt, endsAt: null };
}

function entryFixture(index: number, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    entryId: `entry-${index}`,
    entryName: `Entry ${index}`,
    entryNumber: 1,
    squadId: `squad-${index}`,
    squadName: `Squad ${index}`,
    status: 'SUBMITTED',
    position: index,
    displayPosition: String(index),
    countingPickLimit: 4,
    scoredPickCount: 4,
    golf: { totalScoreToPar: index - 6 },
    picks: [],
    ...overrides,
  };
}

function leaderboardFixture(entries: LeaderboardEntry[]): ContestLeaderboardResponse {
  return {
    contestId: 'contest-1',
    sportEventId: 'event-1',
    scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    countingRule: { type: 'BEST_N_GOLFERS', count: 4 },
    participants: [],
    entries,
    asOf: null,
  };
}

function entries(count: number): LeaderboardEntry[] {
  return Array.from({ length: count }, (_, offset) => entryFixture(offset + 1));
}

describe('pickUpNextContest', () => {
  it('picks the open contest whose entries close soonest', () => {
    const later = contestFixture({ id: 'later' });
    const sooner = contestFixture({ id: 'sooner' });

    const result = pickUpNextContest(
      [later, sooner],
      [schedule('2026-05-10T12:00:00.000Z'), schedule('2026-05-03T12:00:00.000Z')],
      NOW,
    );

    expect(result).toEqual({ contest: sooner, closesAt: '2026-05-03T12:00:00.000Z' });
  });

  it('skips an open contest whose entry cutoff has already passed', () => {
    const closed = contestFixture({ id: 'closed' });
    const upcoming = contestFixture({ id: 'upcoming' });

    const result = pickUpNextContest(
      [closed, upcoming],
      [schedule('2026-04-30T12:00:00.000Z'), schedule('2026-05-05T12:00:00.000Z')],
      NOW,
    );

    expect(result?.contest.id).toBe('upcoming');
  });

  it('skips contests that are not open, even when their cutoff is soonest', () => {
    const draft = contestFixture({ id: 'draft', status: 'DRAFT' });
    const active = contestFixture({ id: 'active', status: 'ACTIVE' });
    const completed = contestFixture({ id: 'completed', status: 'COMPLETED' });
    const open = contestFixture({ id: 'open' });

    const result = pickUpNextContest(
      [draft, active, completed, open],
      [
        schedule('2026-05-02T12:00:00.000Z'),
        schedule('2026-05-02T12:00:00.000Z'),
        schedule('2026-05-02T12:00:00.000Z'),
        schedule('2026-05-09T12:00:00.000Z'),
      ],
      NOW,
    );

    expect(result?.contest.id).toBe('open');
  });

  it('skips an open contest with no known cutoff', () => {
    const unscheduled = contestFixture({ id: 'unscheduled' });
    const scheduled = contestFixture({ id: 'scheduled' });

    const result = pickUpNextContest([unscheduled, scheduled], [null, schedule('2026-05-09T12:00:00.000Z')], NOW);

    expect(result?.contest.id).toBe('scheduled');
  });

  it('returns null when no contest is open with a future cutoff', () => {
    const result = pickUpNextContest(
      [
        contestFixture({ id: 'unscheduled' }),
        contestFixture({ id: 'past' }),
        contestFixture({ id: 'live', status: 'ACTIVE' }),
      ],
      [null, schedule('2026-04-01T12:00:00.000Z'), schedule('2026-05-09T12:00:00.000Z')],
      NOW,
    );

    expect(result).toBeNull();
  });

  it('returns null when there are no contests', () => {
    expect(pickUpNextContest([], [], NOW)).toBeNull();
  });
});

describe('countdownUntil', () => {
  it('splits the time remaining into whole days, hours and minutes', () => {
    // 2 days, 3 hours, 4 minutes and 59 seconds after NOW: the partial minute is dropped.
    expect(countdownUntil('2026-05-03T15:04:59.000Z', NOW)).toEqual({ days: 2, hours: 3, minutes: 4 });
  });

  it('reads zero days when less than a day remains', () => {
    expect(countdownUntil('2026-05-01T13:30:00.000Z', NOW)).toEqual({ days: 0, hours: 1, minutes: 30 });
  });

  it('never goes negative once the moment has passed', () => {
    expect(countdownUntil('2026-04-29T08:00:00.000Z', NOW)).toEqual({ days: 0, hours: 0, minutes: 0 });
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
      name: 'Squad 1',
      position: '1',
      total: '-5',
    });
    expect(result.rows[4]?.total).toBe('-1');
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
      name: 'Squad 7',
      position: '7',
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
      leaderboardFixture([entryFixture(1, { golf: { totalScoreToPar: null }, displayPosition: null })]),
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
