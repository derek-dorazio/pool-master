import {
  compareScores,
  ContestRulesWithEntryLimitSchema,
  FINISH_POSITION_POINTS_TABLE_MAX_PLACES,
  FinishPositionPointsSettingsSchema,
  PARTICIPANT_SCORING_DEFINITIONS,
  PARTICIPANT_SCORING_SETTINGS_SCHEMAS,
  parseContestScoringSettings,
  rankSortedScores,
} from '@poolmaster/shared/domain';

describe('participant scoring definitions', () => {
  it('declares golf stroke play lower-is-better and renders level par as "E"', () => {
    const definition = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL;

    expect(definition.direction).toBe('LOWER_IS_BETTER');
    expect([-3, 0, 4].map(definition.format)).toEqual(['-3', 'E', '+4']);
  });

  // #248 — the rule `displayType`/`displayValue` used to carry, now the registry's.
  describe('formatRound (golf)', () => {
    const { formatRound } = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL;

    it('renders a completed round as its strokes', () => {
      expect(formatRound({ status: 'COMPLETED', strokes: 69, scoreToPar: -3 })).toBe('69');
    });

    it('renders a round still in progress against par, with level par as "E"', () => {
      expect(formatRound({ status: 'IN_PROGRESS', strokes: 47, scoreToPar: -2 })).toBe('-2');
      expect(formatRound({ status: 'IN_PROGRESS', strokes: 36, scoreToPar: 0 })).toBe('E');
      expect(formatRound({ status: 'IN_PROGRESS', strokes: 40, scoreToPar: 3 })).toBe('+3');
    });

    it('renders a round that ended short of completion against par', () => {
      expect(formatRound({ status: 'MISSED_CUT', strokes: 78, scoreToPar: 6 })).toBe('+6');
      expect(formatRound({ status: 'DNF', strokes: 40, scoreToPar: 1 })).toBe('+1');
    });
  });
});

describe('compareScores', () => {
  it('orders the lowest score first when lower is better, and the highest first when higher is better', () => {
    const scores = [2, -1, 5];

    expect([...scores].sort((l, r) => compareScores('LOWER_IS_BETTER', l, r))).toEqual([-1, 2, 5]);
    expect([...scores].sort((l, r) => compareScores('HIGHER_IS_BETTER', l, r))).toEqual([5, 2, -1]);
  });

  it('sorts an unscored value last in both directions', () => {
    const scores = [null, 3, 1];

    expect([...scores].sort((l, r) => compareScores('LOWER_IS_BETTER', l, r))).toEqual([1, 3, null]);
    expect([...scores].sort((l, r) => compareScores('HIGHER_IS_BETTER', l, r))).toEqual([3, 1, null]);
  });
});

// #246 — the one ranking rule, shared by contest entries and event participants.
describe('rankSortedScores', () => {
  it('gives tied scores one position shown as "T<n>", and the next score its index + 1', () => {
    expect(rankSortedScores([-5, -2, -2, 1, 1, 1, 4])).toEqual([
      { position: 1, displayPosition: '1' },
      { position: 2, displayPosition: 'T2' },
      { position: 2, displayPosition: 'T2' },
      { position: 4, displayPosition: 'T4' },
      { position: 4, displayPosition: 'T4' },
      { position: 4, displayPosition: 'T4' },
      { position: 7, displayPosition: '7' },
    ]);
  });

  it('leaves unscored items unranked', () => {
    expect(rankSortedScores([3, null, null])).toEqual([
      { position: 1, displayPosition: '1' },
      { position: null, displayPosition: null },
      { position: null, displayPosition: null },
    ]);
  });
});

describe('participant scoring settings', () => {
  it('declares a settings schema for every scoring definition, and no schema for an id that is not one', () => {
    expect(Object.keys(PARTICIPANT_SCORING_SETTINGS_SCHEMAS).sort()).toEqual(Object.keys(PARTICIPANT_SCORING_DEFINITIONS).sort());
  });

  it('reads golf\'s to-par total settings as the empty object, dropping keys retired before settings were typed', () => {
    expect(parseContestScoringSettings('GOLF_RELATIVE_TO_PAR_TOTAL', {})).toEqual({
      success: true,
      data: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} },
    });
    expect(parseContestScoringSettings('GOLF_RELATIVE_TO_PAR_TOTAL', { cutRule: { type: 'FIXED_SCORE', fixedScore: 80 }, playoffHandling: 'EXCLUDE_PLAYOFF_HOLES' }))
      .toEqual({ success: true, data: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} } });
  });

  it.each([['an array', []], ['a string', 'points'], ['null', null]])('refuses golf settings stored as %s with SETTINGS_INVALID', (_label, config) => {
    expect(parseContestScoringSettings('GOLF_RELATIVE_TO_PAR_TOTAL', config)).toEqual({
      success: false,
      reason: 'SETTINGS_INVALID',
      participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    });
  });

  it('reads settings for a definition the registry does not know as DEFINITION_UNKNOWN, keeping the stored id', () => {
    expect(parseContestScoringSettings('STABLEFORD_POINTS', {})).toEqual({
      success: false,
      reason: 'DEFINITION_UNKNOWN',
      participantScoringDefinitionId: 'STABLEFORD_POINTS',
    });
  });
});

describe('finish-position points', () => {
  it('declares finish-position points higher-is-better in points, with no per-round format', () => {
    const definition = PARTICIPANT_SCORING_DEFINITIONS.FINISH_POSITION_POINTS;

    expect(definition.direction).toBe('HIGHER_IS_BETTER');
    expect(definition.unit).toBe('POINTS');
    expect([0, 5, 25].map(definition.format)).toEqual(['0', '5', '25']);
    expect(definition.formatRound).toBeNull();
  });

  it('accepts Win / Place / Show and a table with zeros and equal places', () => {
    expect(FinishPositionPointsSettingsSchema.safeParse({ pointsTable: [5, 3, 1], didNotFinishPoints: 0 }).success).toBe(true);
    expect(FinishPositionPointsSettingsSchema.safeParse({ pointsTable: [10, 10, 0], didNotFinishPoints: 2 }).success).toBe(true);
  });

  it.each([
    ['an empty points table', { pointsTable: [], didNotFinishPoints: 0 }],
    ['a negative place value', { pointsTable: [5, -1], didNotFinishPoints: 0 }],
    ['a fractional place value', { pointsTable: [5, 2.5], didNotFinishPoints: 0 }],
    ['a worse place scoring more than a better one', { pointsTable: [3, 5, 1], didNotFinishPoints: 0 }],
    ['more places than the table allows', { pointsTable: Array.from({ length: FINISH_POSITION_POINTS_TABLE_MAX_PLACES + 1 }, () => 1), didNotFinishPoints: 0 }],
    ['negative did-not-finish points', { pointsTable: [5, 3, 1], didNotFinishPoints: -1 }],
    ['no did-not-finish points', { pointsTable: [5, 3, 1] }],
  ])('refuses settings with %s', (_label, settings) => {
    expect(FinishPositionPointsSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it('reads stored finish-position settings back typed, and a stored table that is not one as SETTINGS_INVALID', () => {
    expect(parseContestScoringSettings('FINISH_POSITION_POINTS', { pointsTable: [5, 3, 1], didNotFinishPoints: 0 })).toEqual({
      success: true,
      data: { participantScoringDefinitionId: 'FINISH_POSITION_POINTS', config: { pointsTable: [5, 3, 1], didNotFinishPoints: 0 } },
    });
    expect(parseContestScoringSettings('FINISH_POSITION_POINTS', {})).toEqual({
      success: false,
      reason: 'SETTINGS_INVALID',
      participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
    });
  });

  it('lets contest rules carry finish-position scoring and refuses scoring settings that do not match their definition', () => {
    const rules = { selectionType: 'TIERED', picksPerTier: 1, countedScores: 3 };

    expect(ContestRulesWithEntryLimitSchema.safeParse({
      ...rules,
      scoring: { participantScoringDefinitionId: 'FINISH_POSITION_POINTS', config: { pointsTable: [5, 3, 1], didNotFinishPoints: 0 } },
    }).success).toBe(true);
    expect(ContestRulesWithEntryLimitSchema.safeParse({
      ...rules,
      scoring: { participantScoringDefinitionId: 'FINISH_POSITION_POINTS', config: {} },
    }).success).toBe(false);
  });
});
