import {
  SPORT_DEFINITIONS,
  ScoringFamily,
  SportEventStatus,
  Sport,
  assertNever,
  eventSportDefinition,
  type ContestScoringSettings,
  type SportLeagueEvent,
} from '@poolmaster/shared/domain';
import {
  getScoringFamilyModule,
  scoringFamilyForEvent,
} from '../../../packages/core-api/src/modules/scoring-families';
import { expectDefined } from '../../support/expect-defined';

// The scoring-family conformance suite (#606): every family in the registry gets these checks.

/** A contest's scoring on an event: its sport league's default definition, with representative settings. */
function defaultScoring(event: SportLeagueEvent): ContestScoringSettings {
  const participantScoringDefinitionId = expectDefined(eventSportDefinition(event).scoringDefinitions.at(0), `${event.sport}'s scoring definition`);
  switch (participantScoringDefinitionId) {
    case 'GOLF_RELATIVE_TO_PAR_TOTAL':
      return { participantScoringDefinitionId, config: {} };
    case 'COMPOSITE_TOTAL':
      return { participantScoringDefinitionId, config: {} };
    case 'FINISH_POSITION_POINTS':
      return { participantScoringDefinitionId, config: { pointsTable: [5, 3, 1], didNotFinishPoints: 0 } };
    case 'KNOCKOUT_ROUND_POINTS':
      return { participantScoringDefinitionId, config: { roundValues: [1, 2, 4, 8], upsetBonus: { rule: 'NONE' } } };
    default:
      return assertNever(participantScoringDefinitionId);
  }
}

/** An event of each family: a sport's that names it, else a sport league's that does (composite: a World Series stat pool). */
const EVENT_BY_SCORING_FAMILY = new Map<ScoringFamily, SportLeagueEvent>([
  ...Object.values(SPORT_DEFINITIONS).map((definition) => [definition.scoringFamily, { sport: definition.sport }] as const),
  [ScoringFamily.COMPOSITE, { sport: Sport.BASEBALL, scoringFamily: ScoringFamily.COMPOSITE }],
]);

describe.each(Object.values(ScoringFamily))('scoring family %s', (family) => {
  const module = getScoringFamilyModule(family);
  // A family is only reached through an event whose sport league names it, so it is exercised as one.
  const event = expectDefined(EVENT_BY_SCORING_FAMILY.get(family), `an event scored by ${family}`);

  it('scores an empty field as no participants', () => {
    expect(module.scoreField([], { ...event, rounds: 4, roundsPar: 72, status: SportEventStatus.IN_PROGRESS }, defaultScoring(event))).toEqual([]);
  });

  it('is the module an event of its sport league resolves to', () => {
    expect(scoringFamilyForEvent(event)).toBe(module);
  });
});

describe('stroke play', () => {
  it('accepts GOLF live scores, the category its golf round rows are written from', () => {
    expect(getScoringFamilyModule(ScoringFamily.STROKE_PLAY).liveScores?.category).toBe('GOLF');
  });
});

describe('head to head', () => {
  it('accepts no live scores, so the score publisher skips any batch for a bracket event', () => {
    expect(getScoringFamilyModule(ScoringFamily.HEAD_TO_HEAD).liveScores).toBeNull();
  });
});

describe('finish position', () => {
  it('accepts no live scores, so the score publisher skips any batch for a race', () => {
    expect(getScoringFamilyModule(ScoringFamily.FINISH_POSITION).liveScores).toBeNull();
  });
});

describe('scoring family registry', () => {
  it('resolves every registered sport to the module of the family its definition names', () => {
    for (const definition of Object.values(SPORT_DEFINITIONS)) {
      expect(scoringFamilyForEvent({ sport: definition.sport })).toBe(getScoringFamilyModule(definition.scoringFamily));
    }
  });
});
