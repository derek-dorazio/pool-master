import { SPORT_DEFINITIONS, ScoringFamily, SportEventStatus } from '@poolmaster/shared/domain';
import type { ContestEntryStandingResult } from '@poolmaster/shared/db';
import {
  getScoringFamilyModule,
  scoringFamilyForSport,
} from '../../../packages/core-api/src/modules/scoring-families';
import { expectDefined } from '../../support/expect-defined';

// The scoring-family conformance suite (#606): every family in the registry gets these checks.

function settledStanding(detail: Pick<ContestEntryStandingResult, 'golf'>): ContestEntryStandingResult {
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

const SPORT_BY_SCORING_FAMILY = new Map(
  Object.values(SPORT_DEFINITIONS).map((definition) => [definition.scoringFamily, definition.sport]),
);

describe.each(Object.values(ScoringFamily))('scoring family %s', (family) => {
  const module = getScoringFamilyModule(family);
  // A family is only reached through a sport that names it, so it is exercised as one.
  const sport = expectDefined(SPORT_BY_SCORING_FAMILY.get(family), `a sport scored by ${family}`);

  it('reads back the settled total it stores on an entry standing, and an unscored entry as null', () => {
    expect(module.settledEntryTotal(settledStanding(module.entryStandingDetail(-7)))).toBe(-7);
    expect(module.settledEntryTotal(settledStanding(module.entryStandingDetail(null)))).toBeNull();
  });

  it('scores an empty field as no participants', () => {
    expect(module.scoreField([], { sport, rounds: 4, roundsPar: 72, status: SportEventStatus.IN_PROGRESS })).toEqual([]);
  });
});

describe('scoring family registry', () => {
  it('resolves every registered sport to the module of the family its definition names', () => {
    for (const definition of Object.values(SPORT_DEFINITIONS)) {
      expect(scoringFamilyForSport(definition.sport)).toBe(getScoringFamilyModule(definition.scoringFamily));
    }
  });
});
