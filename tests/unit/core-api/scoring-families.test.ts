import {
  SPORT_DEFINITIONS,
  ScoringFamily,
  SportEventStatus,
  assertNever,
  getSportDefinition,
  type ContestScoringSettings,
  type Sport,
} from '@poolmaster/shared/domain';
import type { ContestEntryStandingResult } from '@poolmaster/shared/db';
import {
  getScoringFamilyModule,
  scoringFamilyForSport,
} from '../../../packages/core-api/src/modules/scoring-families';
import { expectDefined } from '../../support/expect-defined';

// The scoring-family conformance suite (#606): every family in the registry gets these checks.

function settledStanding(detail: Pick<ContestEntryStandingResult, 'golf' | 'race'>): ContestEntryStandingResult {
  return {
    id: 'standing-1',
    contestId: 'contest-1',
    contestEntryId: 'entry-1',
    position: 1,
    displayPosition: '1',
    countingPickLimit: 4,
    scoredPickCount: 4,
    asOf: null,
    settledAt: new Date('2026-04-12T23:00:00.000Z'),
    ...detail,
  };
}

/** A contest's scoring in a sport: its default definition, with representative settings. */
function defaultScoring(sport: Sport): ContestScoringSettings {
  const [participantScoringDefinitionId] = getSportDefinition(sport).scoringDefinitions;
  switch (participantScoringDefinitionId) {
    case 'GOLF_RELATIVE_TO_PAR_TOTAL':
      return { participantScoringDefinitionId, config: {} };
    case 'FINISH_POSITION_POINTS':
      return { participantScoringDefinitionId, config: { pointsTable: [5, 3, 1], didNotFinishPoints: 0 } };
    default:
      return assertNever(participantScoringDefinitionId);
  }
}

const SPORT_BY_SCORING_FAMILY = new Map(
  Object.values(SPORT_DEFINITIONS).map((definition) => [definition.scoringFamily, definition.sport]),
);

describe.each(Object.values(ScoringFamily))('scoring family %s', (family) => {
  const module = getScoringFamilyModule(family);
  // A family is only reached through a sport that names it, so it is exercised as one.
  const sport = expectDefined(SPORT_BY_SCORING_FAMILY.get(family), `a sport scored by ${family}`);

  it('reads back the settled total it stores on an entry standing, and an unscored entry as null', () => {
    expect(module.settledEntryTotal(settledStanding(module.entryStandingDetail(-7)))).toBe(-7);
    expect(module.settledEntryTotal(settledStanding(module.entryStandingDetail(0)))).toBe(0);
    expect(module.settledEntryTotal(settledStanding(module.entryStandingDetail(null)))).toBeNull();
  });

  it('scores an empty field as no participants', () => {
    expect(module.scoreField([], { sport, rounds: 4, roundsPar: 72, status: SportEventStatus.IN_PROGRESS }, defaultScoring(sport))).toEqual([]);
  });
});

describe('stroke play', () => {
  it('accepts GOLF live scores, the category its golf round rows are written from', () => {
    expect(getScoringFamilyModule(ScoringFamily.STROKE_PLAY).liveScores?.category).toBe('GOLF');
  });
});

describe('finish position', () => {
  it('accepts no live scores, so the score publisher skips any batch for a race', () => {
    expect(getScoringFamilyModule(ScoringFamily.FINISH_POSITION).liveScores).toBeNull();
  });

  it('stores an entry\'s total on the race standing extension and leaves the golf one empty', () => {
    expect(getScoringFamilyModule(ScoringFamily.FINISH_POSITION).entryStandingDetail(8)).toEqual({
      golf: null,
      race: { totalPoints: 8 },
    });
  });
});

describe('scoring family registry', () => {
  it('resolves every registered sport to the module of the family its definition names', () => {
    for (const definition of Object.values(SPORT_DEFINITIONS)) {
      expect(scoringFamilyForSport(definition.sport)).toBe(getScoringFamilyModule(definition.scoringFamily));
    }
  });
});
