import { MatchStatus, chooseSlotTiebreakerGame, hasTiebreakerGameStarted, type SlotTiebreakerCandidate } from '@poolmaster/shared/domain';

const game = (id: string, scheduledDate: string | null, overrides: Partial<SlotTiebreakerCandidate> = {}): SlotTiebreakerCandidate => ({
  id,
  scheduledDate: scheduledDate === null ? null : new Date(scheduledDate),
  roundNumber: 1,
  status: MatchStatus.SCHEDULED,
  moved: false,
  ...overrides,
});

describe('chooseSlotTiebreakerGame', () => {
  it('picks the game with the latest scheduled start, wherever it sits in the list', () => {
    const late = game('b0000000-0000-4000-8000-000000000002', '2027-01-10T21:25:00Z');
    expect(chooseSlotTiebreakerGame([
      game('a0000000-0000-4000-8000-000000000001', '2027-01-10T18:00:00Z'),
      late,
      game('c0000000-0000-4000-8000-000000000003', '2027-01-10T13:00:00Z'),
    ])).toBe(late);
  });

  it('breaks a tie on the latest start by the lower Game id, not by list order', () => {
    const lower = game('a0000000-0000-4000-8000-000000000001', '2027-01-10T21:25:00Z');
    expect(chooseSlotTiebreakerGame([
      game('f0000000-0000-4000-8000-000000000009', '2027-01-10T21:25:00Z'),
      lower,
    ])).toBe(lower);
  });

  it('never picks a cancelled game or a game moved to another slot, and ranks a game with no start yet after every scheduled one', () => {
    const kept = game('d0000000-0000-4000-8000-000000000004', '2027-01-10T13:00:00Z');
    expect(chooseSlotTiebreakerGame([
      game('a0000000-0000-4000-8000-000000000001', '2027-01-11T01:00:00Z', { status: MatchStatus.CANCELLED }),
      game('b0000000-0000-4000-8000-000000000002', '2027-01-11T02:00:00Z', { moved: true }),
      game('c0000000-0000-4000-8000-000000000003', null),
      kept,
    ])).toBe(kept);
  });

  it('names a bracket\'s unscheduled final when no game of the slot has a start: the later round first, whatever the ids', () => {
    const final = game('f0000000-0000-4000-8000-000000000009', null, { roundNumber: 3 });
    expect(chooseSlotTiebreakerGame([
      game('a0000000-0000-4000-8000-000000000001', null, { roundNumber: 1 }),
      game('b0000000-0000-4000-8000-000000000002', null, { roundNumber: 2 }),
      final,
    ])).toBe(final);
  });

  it('breaks a tie between unscheduled games of the same round by the lower Game id', () => {
    const lower = game('a0000000-0000-4000-8000-000000000001', null);
    expect(chooseSlotTiebreakerGame([game('c0000000-0000-4000-8000-000000000003', null), lower])).toBe(lower);
  });

  it('is null for a slot with no game that can be one', () => {
    expect(chooseSlotTiebreakerGame([game('a0000000-0000-4000-8000-000000000001', null, { status: MatchStatus.CANCELLED })])).toBeNull();
    expect(chooseSlotTiebreakerGame([])).toBeNull();
  });
});

describe('hasTiebreakerGameStarted', () => {
  const now = new Date('2027-01-10T20:00:00Z');

  it('is false for a scheduled game whose start is still ahead', () => {
    expect(hasTiebreakerGameStarted(game('a', '2027-01-10T21:25:00Z'), now)).toBe(false);
  });

  it('is true once its start has passed, even before the feed says it is under way', () => {
    expect(hasTiebreakerGameStarted(game('a', '2027-01-10T19:00:00Z'), now)).toBe(true);
  });

  it('is true for a game under way or played, whatever its start says', () => {
    expect(hasTiebreakerGameStarted(game('a', '2027-01-10T21:25:00Z', { status: MatchStatus.IN_PROGRESS }), now)).toBe(true);
    expect(hasTiebreakerGameStarted(game('a', null, { status: MatchStatus.COMPLETED }), now)).toBe(true);
  });

  it('is false for a game with no start yet that has not been played', () => {
    expect(hasTiebreakerGameStarted(game('a', null), now)).toBe(false);
  });

  it('is true for a postponed game whose first start has passed, until its new start is written, and false once it is', () => {
    expect(hasTiebreakerGameStarted(game('a', '2027-01-10T19:00:00Z', { status: MatchStatus.POSTPONED }), now)).toBe(true);
    expect(hasTiebreakerGameStarted(game('a', '2027-01-12T01:15:00Z', { status: MatchStatus.POSTPONED }), now)).toBe(false);
  });
});
