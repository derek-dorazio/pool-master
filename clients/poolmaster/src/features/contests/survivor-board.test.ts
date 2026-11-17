import { describe, expect, it } from 'vitest';
import type { SurvivorLeaderboardResponse } from '@/lib/api';
import {
  survivorCellView,
  survivorCurrentWeek,
  survivorDetailWeeks,
  survivorEarlierLabel,
  survivorGameLine,
  survivorResultLine,
  survivorStatusLabel,
} from './survivor-board';
import { survivorLeaderboardFixture } from './test/pick-em-fixtures';

type Row = SurvivorLeaderboardResponse['entries'][number];
type Pick = Row['weeks'][number];
type Week = SurvivorLeaderboardResponse['weeks'][number];

const weekName = (shown: Week) => shown.name;
const kickoff = (startsAt: string) => `kickoff ${startsAt}`;

function pick(overrides: Partial<Pick> = {}): Pick {
  return { sportEventId: 'week-1', roundNumber: 1, outcome: 'SURVIVED', team: 'Kansas City Chiefs', teamShortName: 'KC', game: null, ...overrides };
}

function game(overrides: Partial<NonNullable<Pick['game']>> = {}): NonNullable<Pick['game']> {
  return {
    opponent: 'Buffalo Bills', opponentShortName: 'BUF', side: 'HOME', isNeutralSite: false,
    scheduledDate: '2026-11-15T18:00:00.000Z', status: 'COMPLETED', teamScore: 27, opponentScore: 20, ...overrides,
  };
}

function week(weekNumber: number, overrides: Partial<Week> = {}): Week {
  return {
    sportEventId: `week-${weekNumber}`, weekNumber, roundNumber: 1, roundCount: 1, name: `Week ${weekNumber}`,
    startDate: '2026-09-01T00:00:00.000Z', status: 'COMPLETED', started: true, aliveCount: 2, ...overrides,
  };
}

function entry(overrides: Partial<Row> = {}): Row {
  const [first] = survivorLeaderboardFixture().entries;
  return { ...first, ...overrides };
}

describe('survivorStatusLabel', () => {
  const weeks = [week(1), week(2), week(3)];

  it('reads In for an entry still in on one life', () => {
    expect(survivorStatusLabel(entry({ livesLeft: 1, livesLost: 0 }), weeks, weekName)).toBe('In');
  });

  it('reads "In · 2 lives" for an entry in a two-life contest that has lost none', () => {
    expect(survivorStatusLabel(entry({ livesLeft: 2, livesLost: 0 }), weeks, weekName)).toBe('In · 2 lives');
  });

  it('reads "In · 1 life left" once a two-life entry has lost a week', () => {
    expect(survivorStatusLabel(entry({ livesLeft: 1, livesLost: 1 }), weeks, weekName)).toBe('In · 1 life left');
  });

  it('names the week an entry went out in, by its name', () => {
    expect(survivorStatusLabel(entry({ alive: false, eliminatedInWeek: 3, livesLeft: 0, livesLost: 1 }), weeks, weekName)).toBe('Out · Week 3');
    expect(survivorStatusLabel(entry({ alive: false, eliminatedInWeek: 9, livesLeft: 0, livesLost: 1 }), weeks, weekName)).toBe('Out · Week 9');
  });

  it('reads plain "Out" for an entry that is out with no week named, never "In"', () => {
    expect(survivorStatusLabel(entry({ alive: false, eliminatedInWeek: null, livesLeft: 0, livesLost: 1 }), weeks, weekName)).toBe('Out');
  });
});

describe('survivorCellView', () => {
  it('shows the team code, green for a week survived and red for a week lost', () => {
    expect(survivorCellView(pick(), null)).toEqual({ kind: 'pick', label: 'KC', tone: 'survived' });
    expect(survivorCellView(pick({ outcome: 'LIFE_LOST' }), null)).toEqual({ kind: 'pick', label: 'KC', tone: 'lost' });
    expect(survivorCellView(pick({ outcome: 'ELIMINATED' }), null)).toEqual({ kind: 'pick', label: 'KC', tone: 'lost' });
  });

  it('falls back to the team\'s name when it has no code', () => {
    expect(survivorCellView(pick({ teamShortName: null }), null)).toEqual({ kind: 'pick', label: 'Kansas City Chiefs', tone: 'survived' });
  });

  it('locks another entry\'s pick until its game kicks off, and shows the viewer\'s own', () => {
    const hidden = pick({ outcome: 'PENDING', team: null, teamShortName: null });
    expect(survivorCellView(hidden, null)).toEqual({ kind: 'hidden' });
    expect(survivorCellView(hidden, 'Eagles')).toEqual({ kind: 'pick', label: 'Eagles', tone: 'pending' });
  });

  it('marks a week lost with no pick, and leaves a week after the entry went out blank', () => {
    expect(survivorCellView(pick({ outcome: 'ELIMINATED', team: null, teamShortName: null }), null)).toEqual({ kind: 'missed' });
    expect(survivorCellView(pick({ outcome: null, team: null, teamShortName: null }), null)).toEqual({ kind: 'blank' });
    expect(survivorCellView(undefined, null)).toEqual({ kind: 'blank' });
  });
});

describe('survivorGameLine', () => {
  it('reads "KC v BUF" at home, "KC at BUF" away and "KC vs BUF" at a neutral site', () => {
    expect(survivorGameLine(pick({ game: game() }))).toBe('KC v BUF');
    expect(survivorGameLine(pick({ game: game({ side: 'AWAY' }) }))).toBe('KC at BUF');
    expect(survivorGameLine(pick({ game: game({ isNeutralSite: true }) }))).toBe('KC vs BUF');
  });

  it('uses full names where a team has no code, and the team alone without a game', () => {
    expect(survivorGameLine(pick({ teamShortName: null, game: game({ opponentShortName: null }) }))).toBe('Kansas City Chiefs v Buffalo Bills');
    expect(survivorGameLine(pick())).toBe('KC');
    expect(survivorGameLine(pick({ team: null, teamShortName: null, outcome: 'ELIMINATED' }))).toBe('No pick');
  });
});

describe('survivorResultLine', () => {
  it('says a survived week was won, with its score', () => {
    expect(survivorResultLine(pick({ game: game() }), null, kickoff)).toBe('✓ Won 27–⁠20');
  });

  it('says a lost week was lost, with the lives it leaves, or that it put the entry out', () => {
    expect(survivorResultLine(pick({ outcome: 'LIFE_LOST', game: game({ teamScore: 20, opponentScore: 24 }) }), 1, kickoff)).toBe('✗ Lost 20–⁠24 · 1 life left');
    expect(survivorResultLine(pick({ outcome: 'ELIMINATED', game: game({ teamScore: 20, opponentScore: 24 }) }), 0, kickoff)).toBe('✗ Lost 20–⁠24 · Out');
    expect(survivorResultLine(pick({ outcome: 'ELIMINATED', game: game({ teamScore: 20, opponentScore: 20 }) }), 0, kickoff)).toBe('✗ Tied 20–⁠20 · Out');
  });

  it('says a week with no pick cost a life or put the entry out', () => {
    expect(survivorResultLine(pick({ outcome: 'LIFE_LOST', team: null, teamShortName: null }), 1, kickoff)).toBe('✗ No pick · 1 life left');
    expect(survivorResultLine(pick({ outcome: 'ELIMINATED', team: null, teamShortName: null }), 0, kickoff)).toBe('✗ No pick · Out');
  });

  it('gives a game still to come its kickoff, a game under way "Playing now", and a cancelled game its status', () => {
    expect(survivorResultLine(pick({ outcome: 'PENDING', game: game({ status: 'SCHEDULED', teamScore: null, opponentScore: null }) }), null, kickoff))
      .toBe('kickoff 2026-11-15T18:00:00.000Z');
    expect(survivorResultLine(pick({ outcome: 'PENDING', game: game({ status: 'SCHEDULED', scheduledDate: null }) }), null, kickoff)).toBe('Time to be set');
    expect(survivorResultLine(pick({ outcome: 'PENDING', game: game({ status: 'IN_PROGRESS' }) }), null, kickoff)).toBe('Playing now');
    expect(survivorResultLine(pick({ outcome: 'SURVIVED', game: game({ status: 'CANCELLED' }) }), null, kickoff)).toBe('Cancelled · counts as survived');
  });

  it('says nothing more for a pick still hidden', () => {
    expect(survivorResultLine(pick({ outcome: 'PENDING', team: null, teamShortName: null }), null, kickoff)).toBe('Hidden until kickoff');
  });
});

describe('survivorDetailWeeks', () => {
  it('lists the weeks an entry played, newest first, each lost week with the lives it left', () => {
    const weeks = [week(1), week(2), week(3), week(4)];
    const row = entry({
      livesLeft: 0,
      livesLost: 2,
      weeks: [
        pick({ sportEventId: 'week-1' }),
        pick({ sportEventId: 'week-2', outcome: 'LIFE_LOST' }),
        pick({ sportEventId: 'week-3', outcome: 'ELIMINATED' }),
        pick({ sportEventId: 'week-4', outcome: null, team: null, teamShortName: null }),
      ],
    });

    expect(survivorDetailWeeks(row, weeks).map(({ week: shown, livesLeft }) => [shown.weekNumber, livesLeft])).toEqual([[3, 0], [2, 1], [1, null]]);
  });
});

describe('survivorEarlierLabel', () => {
  it('names a run of earlier weeks by their numbers, and a playoff\'s earlier rounds as rounds', () => {
    expect(survivorEarlierLabel([week(6), week(1)])).toBe('Weeks 1–6');
    expect(survivorEarlierLabel([week(1)])).toBe('Week 1');
    expect(survivorEarlierLabel([week(2, { roundCount: 3, roundNumber: 2 }), week(1, { roundCount: 3 })])).toBe('Earlier rounds');
  });
});

describe('survivorCurrentWeek', () => {
  it('is the latest week started, live while under way, else the first week', () => {
    const live = survivorCurrentWeek([week(1), week(2, { status: 'IN_PROGRESS' }), week(3, { started: false, status: 'SCHEDULED' })]);
    expect([live.week?.weekNumber, live.isLive]).toEqual([2, true]);
    const settled = survivorCurrentWeek([week(1), week(2)]);
    expect([settled.week?.weekNumber, settled.isLive]).toEqual([2, false]);
    const notStarted = survivorCurrentWeek([week(1, { started: false, status: 'SCHEDULED' })]);
    expect([notStarted.week?.weekNumber, notStarted.isLive]).toEqual([1, false]);
    expect(survivorCurrentWeek([])).toEqual({ week: null, isLive: false });
  });
});
