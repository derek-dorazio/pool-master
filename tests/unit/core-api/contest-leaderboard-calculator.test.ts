import { PARTICIPANT_SCORING_DEFINITIONS } from '@poolmaster/shared/domain';
import {
  applySettledContestStandings,
  rankContestEntryStandings,
  resolveContestScoringDefinition,
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
    status: 'ACTIVE' as const,
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
    status: 'ACTIVE' as const,
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
