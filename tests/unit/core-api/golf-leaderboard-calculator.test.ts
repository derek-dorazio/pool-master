import { PARTICIPANT_SCORING_DEFINITIONS } from '@poolmaster/shared/domain';
import {
  buildGolfRoundColumns,
  rankGolfLeaderboardEntries,
  resolveGolfLeaderboardScoringDefinition,
} from '../../../packages/core-api/src/modules/contests/golf-leaderboard-calculator';

describe('golf leaderboard round cells', () => {
  it('renders an in-progress round at level par as "E", the same as the contest entry page and the admin event page', () => {
    const columns = buildGolfRoundColumns([
      { round: 1, strokes: 34, scoreToPar: 0, thru: 9, status: 'IN_PROGRESS' },
    ]);

    expect(columns.r1).toEqual(expect.objectContaining({
      displayType: 'TO_PAR',
      displayValue: 'E',
      thru: 9,
    }));
  });
});

describe('golf leaderboard scoring definition', () => {
  const configuration = (rules: Array<{ participantScoringDefinitionId: string; sortOrder: number; active: boolean }>) => ({
    configJson: {},
    rosterSize: 3,
    pickCount: 3,
    rounds: 4,
    participantScoringRules: rules,
  });

  it('reads the definition off the first active participant scoring rule', () => {
    expect(resolveGolfLeaderboardScoringDefinition(configuration([
      { participantScoringDefinitionId: 'RETIRED_DEFINITION', sortOrder: 1, active: false },
      { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 2, active: true },
    ]))).toBe(PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL);
  });

  it('falls back to golf stroke play when the configuration has no scoring rule row', () => {
    expect(resolveGolfLeaderboardScoringDefinition(configuration([])))
      .toBe(PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL);
  });

  it('refuses to rank by a definition the registry does not know, rather than guessing its direction', () => {
    expect(resolveGolfLeaderboardScoringDefinition(configuration([
      { participantScoringDefinitionId: 'TEAM_WIN_POINTS', sortOrder: 1, active: true },
    ]))).toBeNull();
  });
});

describe('golf leaderboard ranking direction', () => {
  const entry = (entryId: string, entryNumber: number, totalScoreToPar: number | null) => ({
    entryId,
    entryName: entryId,
    entryNumber,
    squadId: `squad-${entryId}`,
    squadName: `Squad ${entryId}`,
    status: 'ACTIVE' as const,
    totalScoreToPar,
    position: null,
    displayPosition: null,
    countingPickCount: 2,
    scoredPickCount: 2,
    picks: [],
  });
  const entries = [entry('high', 1, 4), entry('low', 2, -6), entry('unscored', 3, null)];

  it('puts the lowest total in first position when lower is better, with unscored entries unranked', () => {
    const ranked = rankGolfLeaderboardEntries(entries, 'LOWER_IS_BETTER');

    expect(ranked.map((row) => [row.entryId, row.position])).toEqual([
      ['low', 1],
      ['high', 2],
      ['unscored', null],
    ]);
  });

  it('puts the highest total in first position when higher is better', () => {
    const ranked = rankGolfLeaderboardEntries(entries, 'HIGHER_IS_BETTER');

    expect(ranked.map((row) => [row.entryId, row.position])).toEqual([
      ['high', 1],
      ['low', 2],
      ['unscored', null],
    ]);
  });
});
