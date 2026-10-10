import {
  applySettledContestStandings,
  buildContestEntryStanding,
  rankContestEntryStandings,
  type ContestLeaderboardEntryInput,
  type ParticipantScore,
} from '../../../packages/core-api/src/modules/contests/contest-leaderboard-calculator';

// An entry's standing is its best N picks' scores summed. These pin which picks count, which are dropped, what an unscored pick does, and how entries rank and tie.

describe('contest entry standing — best N of the entry\'s picks', () => {
  const pickedAt = new Date('2026-04-01T12:00:00.000Z');
  const pick = (id: string, sportEventParticipantId: string, slot: number | null = null, at = pickedAt) => ({
    id,
    sportEventParticipantId,
    pickedAt: at,
    slot,
  });
  const entry = (picks: ContestLeaderboardEntryInput['picks'], overrides: Partial<ContestLeaderboardEntryInput> = {}): ContestLeaderboardEntryInput => ({
    id: 'entry-1',
    entryNumber: 1,
    name: 'Fairway Fliers',
    status: 'SUBMITTED',
    squadId: 'squad-1',
    squad: { name: 'Squad One' },
    picks,
    ...overrides,
  });
  const scores = (rows: Array<[string, string, number | null]>) => new Map<string, ParticipantScore>(
    rows.map(([sportEventParticipantId, name, score]) => [sportEventParticipantId, { sportEventParticipantId, name, score, unplayedRoundNumbers: [], asOf: null }]),
  );

  it('sums the lowest N to-par scores and marks every other scored pick dropped', () => {
    const standing = buildContestEntryStanding(
      entry([pick('p1', 'sep-a'), pick('p2', 'sep-b'), pick('p3', 'sep-c'), pick('p4', 'sep-d')]),
      scores([['sep-a', 'Ana', 3], ['sep-b', 'Ben', -4], ['sep-c', 'Cal', 1], ['sep-d', 'Dee', -1]]),
      { type: 'BEST_N_GOLFERS', count: 2 },
      'LOWER_IS_BETTER',
    );

    expect(standing.score).toBe(-5);
    expect(standing.scoredPickCount).toBe(4);
    expect(standing.countingPickLimit).toBe(2);
    expect(standing.picks.map((row) => [row.pickId, row.isCounting, row.isDropped])).toEqual([
      ['p2', true, false],
      ['p4', true, false],
      ['p3', false, true],
      ['p1', false, true],
    ]);
  });

  it('counts the highest N when higher is better', () => {
    const standing = buildContestEntryStanding(
      entry([pick('p1', 'sep-a'), pick('p2', 'sep-b'), pick('p3', 'sep-c')]),
      scores([['sep-a', 'Ana', 10], ['sep-b', 'Ben', 30], ['sep-c', 'Cal', 20]]),
      { type: 'BEST_N_GOLFERS', count: 2 },
      'HIGHER_IS_BETTER',
    );

    expect(standing.score).toBe(50);
    expect(standing.picks.filter((row) => row.isCounting).map((row) => row.pickId)).toEqual(['p2', 'p3']);
  });

  it('never counts or drops an unscored pick, and totals only the scored picks when fewer than N are scored', () => {
    const standing = buildContestEntryStanding(
      entry([pick('p1', 'sep-a', 2), pick('p2', 'sep-b', 1), pick('p3', 'sep-c', 3)]),
      scores([['sep-a', 'Ana', -2], ['sep-b', 'Ben', null], ['sep-c', 'Cal', null]]),
      { type: 'BEST_N_GOLFERS', count: 2 },
      'LOWER_IS_BETTER',
    );

    expect(standing.score).toBe(-2);
    expect(standing.scoredPickCount).toBe(1);
    expect(standing.picks.map((row) => [row.pickId, row.isCounting, row.isDropped])).toEqual([
      ['p1', true, false],
      ['p2', false, false],
      ['p3', false, false],
    ]);
  });

  it('gives an entry with no scored pick no score, rather than zero', () => {
    const standing = buildContestEntryStanding(
      entry([pick('p1', 'sep-a')]),
      scores([['sep-a', 'Ana', null]]),
      { type: 'BEST_N_GOLFERS', count: 2 },
      'LOWER_IS_BETTER',
    );

    expect(standing.score).toBeNull();
    expect(standing.scoredPickCount).toBe(0);
  });

  it('gives an entry whose counted golfers are all even par a score of 0, not no score', () => {
    const standing = buildContestEntryStanding(
      entry([pick('p1', 'sep-a'), pick('p2', 'sep-b')]),
      scores([['sep-a', 'Ana', 0], ['sep-b', 'Ben', 0]]),
      { type: 'BEST_N_GOLFERS', count: 2 },
      'LOWER_IS_BETTER',
    );

    expect(standing.score).toBe(0);
  });

  it('breaks a tie for the last counting place by golfer name, so the same pick always counts', () => {
    const standing = buildContestEntryStanding(
      entry([pick('p1', 'sep-z'), pick('p2', 'sep-a'), pick('p3', 'sep-b')]),
      scores([['sep-z', 'Zed', -3], ['sep-a', 'Abe', 1], ['sep-b', 'Bo', 1]]),
      { type: 'BEST_N_GOLFERS', count: 2 },
      'LOWER_IS_BETTER',
    );

    expect(standing.score).toBe(-2);
    expect(standing.picks.map((row) => [row.pickId, row.isCounting])).toEqual([
      ['p1', true],
      ['p2', true],
      ['p3', false],
    ]);
  });

  it('breaks a tie between two picks of the same name by pick id', () => {
    const standing = buildContestEntryStanding(
      entry([pick('p2', 'sep-a'), pick('p1', 'sep-b')]),
      scores([['sep-a', 'Same Name', 1], ['sep-b', 'Same Name', 1]]),
      { type: 'BEST_N_GOLFERS', count: 1 },
      'LOWER_IS_BETTER',
    );

    expect(standing.picks.map((row) => [row.pickId, row.isCounting])).toEqual([
      ['p1', true],
      ['p2', false],
    ]);
  });

  it('lists unscored picks after scored ones by roster slot, an unslotted pick last, then by pick time', () => {
    const early = new Date('2026-04-01T10:00:00.000Z');
    const late = new Date('2026-04-01T11:00:00.000Z');
    const standing = buildContestEntryStanding(
      entry([
        pick('p-unslotted', 'sep-u'),
        pick('p-slot2-late', 'sep-c', 2, late),
        pick('p-slot2-early', 'sep-b', 2, early),
        pick('p-slot1', 'sep-a', 1),
        pick('p-unslotted-2', 'sep-v'),
        pick('p-scored', 'sep-s', 9),
      ]),
      scores([
        ['sep-u', 'U', null], ['sep-c', 'C', null], ['sep-b', 'B', null], ['sep-a', 'A', null], ['sep-v', 'V', null], ['sep-s', 'S', 4],
      ]),
      { type: 'BEST_N_GOLFERS', count: 4 },
      'LOWER_IS_BETTER',
    );

    expect(standing.picks.map((row) => row.pickId)).toEqual([
      'p-scored',
      'p-slot1',
      'p-slot2-early',
      'p-slot2-late',
      'p-unslotted',
      'p-unslotted-2',
    ]);
  });

  it('leaves out a pick whose golfer is no longer on the event\'s field', () => {
    const standing = buildContestEntryStanding(
      entry([pick('p1', 'sep-a'), pick('p2', 'sep-gone')]),
      scores([['sep-a', 'Ana', -1]]),
      { type: 'BEST_N_GOLFERS', count: 2 },
      'LOWER_IS_BETTER',
    );

    expect(standing.picks.map((row) => row.pickId)).toEqual(['p1']);
    expect(standing.score).toBe(-1);
  });

  it('reports a DRAFT entry as DRAFT and a SUBMITTED entry as SUBMITTED', () => {
    const map = scores([]);
    const rule = { type: 'BEST_N_GOLFERS' as const, count: 1 };
    expect(buildContestEntryStanding(entry([], { status: 'DRAFT' }), map, rule, 'LOWER_IS_BETTER').status).toBe('DRAFT');
    expect(buildContestEntryStanding(entry([], { status: 'SUBMITTED' }), map, rule, 'LOWER_IS_BETTER').status).toBe('SUBMITTED');
  });

  it('carries the entry and squad names and leaves position for the ranking step', () => {
    const standing = buildContestEntryStanding(entry([]), scores([]), { type: 'BEST_N_GOLFERS', count: 1 }, 'LOWER_IS_BETTER');

    expect(standing).toMatchObject({
      entryId: 'entry-1',
      entryName: 'Fairway Fliers',
      entryNumber: 1,
      squadId: 'squad-1',
      squadName: 'Squad One',
      position: null,
      displayPosition: null,
    });
  });
});

describe('contest entry ranking — ties', () => {
  const row = (entryId: string, entryNumber: number, score: number | null, entryName = entryId) => ({
    entryId,
    entryName,
    entryNumber,
    squadId: 'squad',
    squadName: 'Squad',
    status: 'SUBMITTED' as const,
    score,
    position: null,
    displayPosition: null,
    countingPickLimit: 2,
    scoredPickCount: 2,
    picks: [],
  });

  it('gives tied entries the same position shown as "T", and the next entry the position after them', () => {
    const ranked = rankContestEntryStandings(
      [row('c', 3, -4), row('a', 1, -4), row('d', 4, 2), row('b', 2, -8)],
      'LOWER_IS_BETTER',
    );

    expect(ranked.map((entry) => [entry.entryId, entry.position, entry.displayPosition])).toEqual([
      ['b', 1, '1'],
      ['a', 2, 'T2'],
      ['c', 2, 'T2'],
      ['d', 4, '4'],
    ]);
  });

  it('orders tied entries by entry number, then name, then id, so the list never reshuffles', () => {
    const ranked = rankContestEntryStandings(
      [row('id-2', 1, 0, 'Bravo'), row('id-1', 1, 0, 'Bravo'), row('id-3', 1, 0, 'Alpha')],
      'LOWER_IS_BETTER',
    );

    expect(ranked.map((entry) => entry.entryId)).toEqual(['id-3', 'id-1', 'id-2']);
  });

  it('leaves every entry unranked when none has a score yet', () => {
    const ranked = rankContestEntryStandings([row('a', 1, null), row('b', 2, null)], 'LOWER_IS_BETTER');

    expect(ranked.map((entry) => [entry.entryId, entry.position, entry.displayPosition])).toEqual([
      ['a', null, null],
      ['b', null, null],
    ]);
  });
});

describe('settled contest standings — unranked standings', () => {
  const row = (entryId: string, entryNumber: number) => ({
    entryId,
    entryName: entryId,
    entryNumber,
    squadId: 'squad',
    squadName: 'Squad',
    status: 'SUBMITTED' as const,
    score: null,
    position: null,
    displayPosition: null,
    countingPickLimit: 2,
    scoredPickCount: 0,
    picks: [],
  });
  const standing = (contestEntryId: string, position: number | null) => ({
    contestEntryId,
    position,
    displayPosition: position === null ? null : String(position),
    countingPickLimit: 2,
    scoredPickCount: 0,
    score: position === null ? null : position,
  });

  it('orders a settled-but-unranked entry after the ranked ones and before an entry with no standing', () => {
    const settled = applySettledContestStandings(
      [row('no-standing', 1), row('unranked', 2), row('second', 3), row('first', 4)],
      [standing('unranked', null), standing('second', 2), standing('first', 1)],
    );

    expect(settled.map((entry) => entry.entryId)).toEqual(['first', 'second', 'unranked', 'no-standing']);
  });

  it('orders entries that share a frozen position by entry number', () => {
    const settled = applySettledContestStandings(
      [row('later', 7), row('earlier', 3)],
      [standing('later', 1), standing('earlier', 1)],
    );

    expect(settled.map((entry) => entry.entryId)).toEqual(['earlier', 'later']);
  });
});
