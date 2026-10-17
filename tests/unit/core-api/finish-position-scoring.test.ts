import {
  RaceResultStatus,
  ScoringFamily,
  Sport,
  SportEventStatus,
  type ContestScoringSettings,
  type SportEventParticipantRaceResult,
} from '@poolmaster/shared/domain';
import { getScoringFamilyModule } from '../../../packages/core-api/src/modules/scoring-families';
import {
  displayPlace,
  placesFormFinishingOrder,
  standingStatusForResult,
} from '../../../packages/core-api/src/modules/scoring-families/finish-position/race-order';
import type { FieldScoringEvent } from '../../../packages/core-api/src/modules/scoring-families/scoring-family-module';
import type { SportEventParticipantView } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// The finish-position family's scoring rules (#622): what a runner's result earns under a
// contest's points table, and when a runner is left unscored.

const family = getScoringFamilyModule(ScoringFamily.FINISH_POSITION);
const RACE: FieldScoringEvent = { sport: Sport.HORSE_RACING, rounds: 1, roundsPar: undefined, status: SportEventStatus.COMPLETED };
const WIN_PLACE_SHOW: ContestScoringSettings = {
  participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
  config: { pointsTable: [5, 3, 1], didNotFinishPoints: -1 },
};

interface RunnerInput {
  name: string;
  isActive?: boolean;
  result?: Partial<Pick<SportEventParticipantRaceResult, 'resultStatus' | 'finishPosition' | 'isOfficial'>> | null;
}

function field(runners: RunnerInput[]): SportEventParticipantView[] {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.HORSE_RACING);
  const event = store.addEvent({ sport: Sport.HORSE_RACING });
  return runners.map(({ name, isActive = true, result }) => {
    const participant = store.addParticipant(sport.id, name);
    const entry = store.addToField(event.id, participant.id, { isActive });
    const raceResult: SportEventParticipantRaceResult | null = result === null || result === undefined ? null : {
      id: store.id('race-result'),
      sportEventParticipantId: entry.id,
      resultStatus: RaceResultStatus.FINISHED,
      finishPosition: null,
      startPosition: null,
      riderName: null,
      isOfficial: true,
      createdAt: new Date('2026-05-02T22:00:00.000Z'),
      updatedAt: new Date('2026-05-02T22:00:00.000Z'),
      ...result,
    };
    return { entry, participant, valuation: null, standing: null, rounds: [], raceResult, matches: [], affiliatedWithSportLeague: true };
  });
}

function scores(runners: RunnerInput[], scoring: ContestScoringSettings = WIN_PLACE_SHOW): Record<string, number | null> {
  return Object.fromEntries(family.scoreField(field(runners), RACE, scoring).map((row) => [row.name, row.score]));
}

describe('finish position — official finishers', () => {
  it('scores each official finisher the points table value at its place', () => {
    expect(scores([
      { name: 'Arrow', result: { finishPosition: 1 } },
      { name: 'Bolt', result: { finishPosition: 2 } },
      { name: 'Comet', result: { finishPosition: 3 } },
    ])).toEqual({ Arrow: 5, Bolt: 3, Comet: 1 });
  });

  it('scores a finisher placed beyond the points table 0, not the table\'s last value', () => {
    expect(scores([
      { name: 'Arrow', result: { finishPosition: 1 } },
      { name: 'Drift', result: { finishPosition: 4 } },
      { name: 'Ember', result: { finishPosition: 9 } },
    ])).toEqual({ Arrow: 5, Drift: 0, Ember: 0 });
  });

  it('scores both runners of a dead heat the full points of the place they share', () => {
    expect(scores([
      { name: 'Arrow', result: { finishPosition: 1 } },
      { name: 'Bolt', result: { finishPosition: 2 } },
      { name: 'Comet', result: { finishPosition: 2 } },
      { name: 'Drift', result: { finishPosition: 4 } },
    ])).toEqual({ Arrow: 5, Bolt: 3, Comet: 3, Drift: 0 });
  });

  it('leaves an official finisher stored without a place unscored rather than inventing one', () => {
    expect(scores([{ name: 'Arrow', result: { finishPosition: null } }])).toEqual({ Arrow: null });
  });
});

describe('finish position — non-finishers', () => {
  it.each([
    RaceResultStatus.DID_NOT_FINISH,
    RaceResultStatus.DISQUALIFIED,
    RaceResultStatus.DID_NOT_START,
  ])('scores an official %s result the contest\'s did-not-finish points', (resultStatus) => {
    expect(scores([
      { name: 'Arrow', result: { finishPosition: 1 } },
      { name: 'Bolt', result: { resultStatus, finishPosition: null } },
    ])).toEqual({ Arrow: 5, Bolt: -1 });
  });

  it('scores a scratched runner with no result the did-not-finish points once the race is official', () => {
    expect(scores([
      { name: 'Arrow', result: { finishPosition: 1 } },
      { name: 'Scratched', isActive: false },
    ])).toEqual({ Arrow: 5, Scratched: -1 });
  });

  it('leaves a scratched runner unscored while the race has no official result', () => {
    expect(scores([
      { name: 'Arrow', result: { finishPosition: 1, isOfficial: false } },
      { name: 'Scratched', isActive: false },
    ])).toEqual({ Arrow: null, Scratched: null });
  });

  it('leaves an active runner with no result unscored even after the race is official', () => {
    expect(scores([
      { name: 'Arrow', result: { finishPosition: 1 } },
      { name: 'Bolt' },
    ])).toEqual({ Arrow: 5, Bolt: null });
  });
});

describe('finish position — unofficial and unscorable results', () => {
  it('leaves every runner unscored while the result is not official, places and non-finishes alike', () => {
    expect(scores([
      { name: 'Arrow', result: { finishPosition: 1, isOfficial: false } },
      { name: 'Bolt', result: { resultStatus: RaceResultStatus.DISQUALIFIED, isOfficial: false } },
    ])).toEqual({ Arrow: null, Bolt: null });
  });

  it('leaves every runner unscored under another family\'s scoring definition instead of guessing points', () => {
    expect(scores(
      [{ name: 'Arrow', result: { finishPosition: 1 } }],
      { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} },
    )).toEqual({ Arrow: null });
  });

  it('tags every scored row with the finish-position detail and the result\'s time as its as-of', () => {
    const [row] = family.scoreField(field([{ name: 'Arrow', result: { finishPosition: 1 } }]), RACE, WIN_PLACE_SHOW);
    expect(row.detail).toEqual({ scoringFamily: ScoringFamily.FINISH_POSITION });
    expect(row.asOf).toEqual(new Date('2026-05-02T22:00:00.000Z'));
  });
});

describe('finishing order shape', () => {
  it.each([
    [[], true],
    [[1], true],
    [[3, 1, 2], true],
    [[1, 2, 2, 4], true],
    [[1, 1, 3], true],
    [[1, 1, 1], true],
    [[2], false],
    [[1, 3], false],
    [[1, 2, 2, 3], false],
    [[1, 1, 2], false],
  ])('treats places %j as a finishing order: %s', (places, expected) => {
    expect(placesFormFinishingOrder(places)).toBe(expected);
  });

  it('shows a place shared by a dead heat as "T" and the place, and an unshared place as the number', () => {
    expect(displayPlace(2, [1, 2, 2, 4])).toBe('T2');
    expect(displayPlace(4, [1, 2, 2, 4])).toBe('4');
  });

  it('marks a runner that started done with the event, and one that did not start withdrawn from it', () => {
    expect(standingStatusForResult(RaceResultStatus.FINISHED)).toBe('COMPLETE');
    expect(standingStatusForResult(RaceResultStatus.DID_NOT_FINISH)).toBe('COMPLETE');
    expect(standingStatusForResult(RaceResultStatus.DISQUALIFIED)).toBe('COMPLETE');
    expect(standingStatusForResult(RaceResultStatus.DID_NOT_START)).toBe('WITHDRAWN');
  });
});
