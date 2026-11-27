import {
  fieldWindowEventIds,
  isQuietWarningDue,
  isSyncDue,
  MatchStatus,
  playUnderwaySince,
  scoresDueSince,
  SYNC_TICK_MS,
} from '@poolmaster/shared/domain';

const NOW = new Date('2026-11-27T18:00:00.000Z');
const minutes = (count: number) => count * 60_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe('isSyncDue', () => {
  it('is due when the sync never ran, and again once its interval has passed since its last run', () => {
    expect(isSyncDue(undefined, minutes(360), NOW)).toBe(true);
    expect(isSyncDue(at(-minutes(360)), minutes(360), NOW)).toBe(true);
    expect(isSyncDue(at(-minutes(359)), minutes(360), NOW)).toBe(false);
  });

  it('is due a few seconds before its interval, so a tick that runs a little early never skips it', () => {
    expect(isSyncDue(at(-minutes(5) + 3_000), minutes(5), NOW)).toBe(true);
    expect(isSyncDue(at(-minutes(5) + 10_000), minutes(5), NOW)).toBe(false);
  });

  it('is due every tick for an interval shorter than a tick', () => {
    expect(isSyncDue(at(-SYNC_TICK_MS), 30_000, NOW)).toBe(true);
  });
});

describe('fieldWindowEventIds', () => {
  it("syncs the events of each league's earliest slot not yet started, and no later slot's", () => {
    expect(fieldWindowEventIds([
      { sportLeagueId: 'nfl', startsAt: at(minutes(60)), sportEventId: 'week-12' },
      { sportLeagueId: 'nfl', startsAt: at(minutes(60 * 24 * 7)), sportEventId: 'week-13' },
      { sportLeagueId: 'pga', startsAt: at(minutes(60 * 24 * 3)), sportEventId: 'rsm-classic' },
    ], NOW)).toEqual(['week-12', 'rsm-classic']);
  });

  it('takes the earlier start of two overlapping competitions, not the next in a list, and every slot starting then', () => {
    expect(fieldWindowEventIds([
      { sportLeagueId: 'ncaaf', startsAt: at(minutes(60 * 24 * 10)), sportEventId: 'cfp-first-round' },
      { sportLeagueId: 'ncaaf', startsAt: at(minutes(60 * 24)), sportEventId: 'bowl-a' },
      { sportLeagueId: 'ncaaf', startsAt: at(minutes(60 * 24)), sportEventId: 'bowl-b' },
    ], NOW)).toEqual(['bowl-a', 'bowl-b']);
  });

  it('leaves out a slot that has started, judged by its start and never by its status', () => {
    expect(fieldWindowEventIds([
      { sportLeagueId: 'ncaab', startsAt: at(-minutes(60)), sportEventId: 'march-madness' },
      { sportLeagueId: 'ncaab', startsAt: NOW, sportEventId: 'march-madness' },
      { sportLeagueId: 'ncaab', startsAt: at(minutes(60 * 48)), sportEventId: 'march-madness' },
    ], NOW)).toEqual(['march-madness']);
  });

  it('names an event in two next slots once', () => {
    expect(fieldWindowEventIds([
      { sportLeagueId: 'ncaab', startsAt: at(minutes(60)), sportEventId: 'march-madness' },
      { sportLeagueId: 'ncaab', startsAt: at(minutes(60)), sportEventId: 'march-madness' },
    ], NOW)).toEqual(['march-madness']);
  });
});

describe('which Games count as due, by when play got under way in them', () => {
  const since = (game: { status: MatchStatus; scheduledDate: Date | null }) => playUnderwaySince([game], NOW);

  it('counts a Game in progress, and a scheduled Game whose start has come', () => {
    expect(since({ status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(90)) })).toEqual(at(-minutes(90)));
    expect(since({ status: MatchStatus.SCHEDULED, scheduledDate: at(-minutes(1)) })).toEqual(at(-minutes(1)));
  });

  it('counts no Game yet to start, one with no start, or one scheduled past an overdue time ago', () => {
    expect(since({ status: MatchStatus.SCHEDULED, scheduledDate: at(minutes(1)) })).toBeNull();
    expect(since({ status: MatchStatus.SCHEDULED, scheduledDate: null })).toBeNull();
    expect(since({ status: MatchStatus.SCHEDULED, scheduledDate: new Date(scoresDueSince(NOW).getTime() - 1) })).toBeNull();
  });

  it('counts no finished, cancelled or postponed Game', () => {
    for (const status of [MatchStatus.COMPLETED, MatchStatus.CANCELLED, MatchStatus.POSTPONED]) {
      expect(since({ status, scheduledDate: at(-minutes(1)) })).toBeNull();
    }
  });
});

describe('playUnderwaySince', () => {
  it("is the earliest start of the event's due Games, and null when none has a start", () => {
    expect(playUnderwaySince([
      { status: MatchStatus.IN_PROGRESS, scheduledDate: at(-minutes(90)) },
      { status: MatchStatus.SCHEDULED, scheduledDate: at(-minutes(10)) },
      { status: MatchStatus.SCHEDULED, scheduledDate: at(minutes(60)) },
    ], NOW)).toEqual(at(-minutes(90)));
    expect(playUnderwaySince([{ status: MatchStatus.IN_PROGRESS, scheduledDate: null }], NOW)).toBeNull();
  });
});

describe('isQuietWarningDue', () => {
  const quiet = (sinceMs: number, lastHeardMs: number | null, quietAfterMs = minutes(20)) => isQuietWarningDue({
    playUnderwaySince: at(-sinceMs),
    lastHeardAt: lastHeardMs === null ? null : at(-lastHeardMs),
    quietAfterMs,
    now: NOW,
    tickMs: SYNC_TICK_MS,
  });

  it('warns on the tick that crosses each whole quiet window since the provider was last heard from, and on no tick between', () => {
    expect(quiet(minutes(60), minutes(20))).toBe(true);
    expect(quiet(minutes(60), minutes(21))).toBe(false);
    expect(quiet(minutes(60), minutes(40))).toBe(true);
  });

  it('counts quiet from when play began while no notification has arrived, so play just starting is not quiet', () => {
    expect(quiet(minutes(5), null)).toBe(false);
    expect(quiet(minutes(20), null)).toBe(true);
  });

  it('never warns about an event notified within its window, or with no quiet window', () => {
    expect(quiet(minutes(60), minutes(2))).toBe(false);
    expect(quiet(minutes(60), null, 0)).toBe(false);
  });
});
