import { ContestEntryStatus, PARTICIPANT_SCORING_DEFINITIONS } from '@poolmaster/shared/domain';
import {
  applySettledContestStandings,
  buildContestEntryStanding,
  rankContestEntryStandings,
  resolveContestCountingRule,
  resolveContestScoringDefinition,
  type ParticipantScore,
} from '../../../packages/core-api/src/modules/contests/contest-leaderboard-calculator';

describe('contest scoring definition', () => {
  const configuration = (rules: Array<{ participantScoringDefinitionId: string; sortOrder: number; active: boolean }>) => ({
    configJson: {},
    rosterSize: 3,
    pickCount: 3,
    rounds: 4,
    participantScoringRules: rules,
  });

  it('reads the definition off the first active participant scoring rule', () => {
    expect(resolveContestScoringDefinition(configuration([
      { participantScoringDefinitionId: 'RETIRED_DEFINITION', sortOrder: 1, active: false },
      { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 2, active: true },
    ]))).toEqual({
      ok: true,
      id: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      definition: PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL,
    });
  });

  // #246 — the golf fallback is gone: every configuration carries a rule, so a missing one
  // is a defect to surface, not a cue to assume golf stroke play.
  it('reports a configuration with no active scoring rule as RULE_MISSING rather than assuming golf', () => {
    expect(resolveContestScoringDefinition(configuration([])))
      .toEqual({ ok: false, reason: 'RULE_MISSING' });
    expect(resolveContestScoringDefinition(configuration([
      { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, active: false },
    ]))).toEqual({ ok: false, reason: 'RULE_MISSING' });
  });

  it('refuses to rank by a definition the registry does not know, rather than guessing its direction', () => {
    expect(resolveContestScoringDefinition(configuration([
      { participantScoringDefinitionId: 'TEAM_WIN_POINTS', sortOrder: 1, active: true },
    ]))).toEqual({ ok: false, reason: 'DEFINITION_UNKNOWN' });
  });
});

describe('contest leaderboard ranking direction', () => {
  const entry = (entryId: string, entryNumber: number, score: number | null) => ({
    entryId,
    entryName: entryId,
    entryNumber,
    squadId: `squad-${entryId}`,
    squadName: `Squad ${entryId}`,
    status: 'SUBMITTED' as const,
    score,
    position: null,
    displayPosition: null,
    countingPickLimit: 2,
    scoredPickCount: 2,
    picks: [],
  });
  const entries = [entry('high', 1, 4), entry('low', 2, -6), entry('unscored', 3, null)];

  it('puts the lowest total in first position when lower is better, with unscored entries unranked', () => {
    const ranked = rankContestEntryStandings(entries, 'LOWER_IS_BETTER');

    expect(ranked.map((row) => [row.entryId, row.position])).toEqual([
      ['low', 1],
      ['high', 2],
      ['unscored', null],
    ]);
  });

  it('puts the highest total in first position when higher is better', () => {
    const ranked = rankContestEntryStandings(entries, 'HIGHER_IS_BETTER');

    expect(ranked.map((row) => [row.entryId, row.position])).toEqual([
      ['high', 1],
      ['low', 2],
      ['unscored', null],
    ]);
  });
});

// #246 — a settled contest reads its frozen standings, whatever the live scores now say.
describe('settled contest standings', () => {
  const entry = (entryId: string, entryNumber: number, score: number | null, position: number | null) => ({
    entryId,
    entryName: `Entry ${entryNumber}`,
    entryNumber,
    squadId: `squad-${entryNumber}`,
    squadName: `Squad ${entryNumber}`,
    status: 'SUBMITTED' as const,
    score,
    position,
    displayPosition: position === null ? null : String(position),
    countingPickLimit: 2,
    scoredPickCount: 2,
    picks: [],
  });

  it('takes each entry\'s rank, total and pick counts from its standing and orders by the frozen rank', () => {
    // Live, entry-b leads (a correction arrived after settlement); frozen, entry-a won.
    const live = [entry('entry-b', 2, -12, 1), entry('entry-a', 1, -3, 2), entry('entry-c', 3, null, null)];
    const settled = applySettledContestStandings(live, [
      { contestEntryId: 'entry-a', position: 1, displayPosition: '1', countingPickLimit: 4, scoredPickCount: 6, score: -9 },
      { contestEntryId: 'entry-b', position: 2, displayPosition: '2', countingPickLimit: 4, scoredPickCount: 5, score: -7 },
      { contestEntryId: 'entry-c', position: null, displayPosition: null, countingPickLimit: 4, scoredPickCount: 0, score: null },
    ]);

    expect(settled.map((row) => [row.entryId, row.position, row.displayPosition, row.score, row.countingPickLimit, row.scoredPickCount]))
      .toEqual([
        ['entry-a', 1, '1', -9, 4, 6],
        ['entry-b', 2, '2', -7, 4, 5],
        ['entry-c', null, null, null, 4, 0],
      ]);
  });

  it('keeps an entry with no standing on its live values, after every settled entry', () => {
    const settled = applySettledContestStandings(
      [entry('late', 1, -20, 1), entry('entry-a', 2, -3, 2)],
      [{ contestEntryId: 'entry-a', position: 1, displayPosition: '1', countingPickLimit: 2, scoredPickCount: 2, score: -3 }],
    );

    expect(settled.map((row) => [row.entryId, row.position, row.score])).toEqual([
      ['entry-a', 1, -3],
      ['late', 1, -20],
    ]);
  });
});

describe('contest counting rule', () => {
  const config = (configJson: unknown, rosterSize: number | null = null, pickCount: number | null = null) => ({
    configJson,
    rosterSize,
    pickCount,
    rounds: null,
    participantScoringRules: [],
  });

  it('counts the configuration\'s countedScores, falling back to rosterSize, then pickCount', () => {
    expect(resolveContestCountingRule(config({ countedScores: 4 }, 6, 6))).toEqual({ type: 'BEST_N_GOLFERS', count: 4 });
    expect(resolveContestCountingRule(config({}, 5, 6))).toEqual({ type: 'BEST_N_GOLFERS', count: 5 });
    expect(resolveContestCountingRule(config(null, null, 3))).toEqual({ type: 'BEST_N_GOLFERS', count: 3 });
  });

  it('ignores a countedScores that is not a positive whole number, and a configJson that is a list', () => {
    expect(resolveContestCountingRule(config({ countedScores: 0 }, 6))).toEqual({ type: 'BEST_N_GOLFERS', count: 6 });
    expect(resolveContestCountingRule(config({ countedScores: 2.5 }, 6))).toEqual({ type: 'BEST_N_GOLFERS', count: 6 });
    expect(resolveContestCountingRule(config({ countedScores: '4' }, 6))).toEqual({ type: 'BEST_N_GOLFERS', count: 6 });
    expect(resolveContestCountingRule(config([{ countedScores: 4 }], 6))).toEqual({ type: 'BEST_N_GOLFERS', count: 6 });
  });

  it('has no counting rule when nothing says how many scores count, or there is no configuration', () => {
    expect(resolveContestCountingRule(config({}, null, null))).toBeNull();
    expect(resolveContestCountingRule(null)).toBeNull();
  });
});

describe('an entry\'s standing from its picks', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 3, 9, 12, minute));
  const scores = (rows: Array<[string, string, number | null]>) => new Map<string, ParticipantScore>(
    rows.map(([id, name, score]) => [id, { sportEventParticipantId: id, name, score, asOf: null }]),
  );
  const entry = (picks: Array<{ id: string; sep: string; slot?: number | null; minute?: number }>) => ({
    id: 'entry-1',
    entryNumber: 1,
    name: 'Sunday Charge',
    status: ContestEntryStatus.SUBMITTED,
    squadId: 'squad-1',
    squad: { name: 'Birdie Brigade' },
    picks: picks.map((pick) => ({
      id: pick.id,
      sportEventParticipantId: pick.sep,
      pickedAt: at(pick.minute ?? 0),
      slot: pick.slot ?? null,
    })),
  });
  const best = (count: number) => ({ type: 'BEST_N_GOLFERS' as const, count });

  it('sums the best N scores, lowest first when lower is better, and marks the rest dropped', () => {
    const field = scores([['a', 'Ace', -8], ['b', 'Bea', 2], ['c', 'Cal', -3], ['d', 'Dee', 5]]);

    const standing = buildContestEntryStanding(
      entry([{ id: 'p1', sep: 'a' }, { id: 'p2', sep: 'b' }, { id: 'p3', sep: 'c' }, { id: 'p4', sep: 'd' }]),
      field,
      best(2),
      'LOWER_IS_BETTER',
    );

    expect(standing.score).toBe(-11);
    expect(standing.scoredPickCount).toBe(4);
    expect(standing.picks.map((pick) => [pick.pickId, pick.isCounting, pick.isDropped])).toEqual([
      ['p1', true, false],
      ['p3', true, false],
      ['p2', false, true],
      ['p4', false, true],
    ]);
  });

  it('counts the highest scores when higher is better', () => {
    const field = scores([['a', 'Ace', 30], ['b', 'Bea', 12], ['c', 'Cal', 25]]);

    const standing = buildContestEntryStanding(
      entry([{ id: 'p1', sep: 'a' }, { id: 'p2', sep: 'b' }, { id: 'p3', sep: 'c' }]),
      field,
      best(2),
      'HIGHER_IS_BETTER',
    );

    expect(standing.score).toBe(55);
  });

  it('breaks a tie between two equal golfers by name, so the same golfer counts on every read', () => {
    const field = scores([['z', 'Zed', -4], ['a', 'Abe', -4]]);

    const standing = buildContestEntryStanding(
      entry([{ id: 'p1', sep: 'z' }, { id: 'p2', sep: 'a' }]),
      field,
      best(1),
      'LOWER_IS_BETTER',
    );

    expect(standing.picks.find((pick) => pick.isCounting)?.pickId).toBe('p2');
  });

  it('leaves unscored golfers neither counting nor dropped, after the scored ones by slot then pick time', () => {
    const field = scores([['a', 'Ace', -2], ['b', 'Bea', null], ['c', 'Cal', null], ['d', 'Dee', null]]);

    const standing = buildContestEntryStanding(
      entry([
        { id: 'p-late', sep: 'b', slot: null, minute: 5 },
        { id: 'p-slot2', sep: 'c', slot: 2 },
        { id: 'p-early', sep: 'd', slot: null, minute: 1 },
        { id: 'p-scored', sep: 'a', slot: 9 },
      ]),
      field,
      best(4),
      'LOWER_IS_BETTER',
    );

    expect(standing.picks.map((pick) => pick.pickId)).toEqual(['p-scored', 'p-slot2', 'p-early', 'p-late']);
    expect(standing.picks.filter((pick) => pick.isDropped)).toEqual([]);
    expect(standing.scoredPickCount).toBe(1);
    expect(standing.score).toBe(-2);
  });

  it('has no score and leaves out a pick whose golfer is no longer in the field', () => {
    const standing = buildContestEntryStanding(
      entry([{ id: 'p1', sep: 'gone' }]),
      scores([]),
      best(4),
      'LOWER_IS_BETTER',
    );

    expect(standing).toMatchObject({ score: null, scoredPickCount: 0, picks: [], countingPickLimit: 4 });
  });

  it('carries the entry\'s own status, active or inactive, onto its standing', () => {
    const field = scores([]);
    expect(buildContestEntryStanding({ ...entry([]), status: ContestEntryStatus.INACTIVE }, field, best(1), 'LOWER_IS_BETTER').status)
      .toBe(ContestEntryStatus.INACTIVE);
    expect(buildContestEntryStanding({ ...entry([]), status: ContestEntryStatus.SUBMITTED }, field, best(1), 'LOWER_IS_BETTER').status)
      .toBe(ContestEntryStatus.SUBMITTED);
  });
});

