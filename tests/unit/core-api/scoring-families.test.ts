import { sportPlay } from '../../support/sport-play';
import type { PrismaClient } from '@prisma/client';
import { NO_CONTEST_ACTIVATION, testDomainEvents } from '../../support/domain-events';
import {
  SPORT_DEFINITIONS,
  ScoringFamily,
  Sport,
  SportEventStatus,
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
import { FIELD_MATCH_WHERE } from '../../../packages/core-api/src/adapters/season-slot-select';

// The scoring-family conformance suite (#606): every family in the registry gets these checks.

/** A contest's scoring on an event: its sport league's default definition, with representative settings. */
function defaultScoring(event: SportLeagueEvent): ContestScoringSettings {
  const participantScoringDefinitionId = expectDefined(eventSportDefinition(event).scoringDefinitions.at(0), `${event.sport}'s scoring definition`);
  switch (participantScoringDefinitionId) {
    case 'GOLF_RELATIVE_TO_PAR_TOTAL':
      return { participantScoringDefinitionId, config: {} };
    case 'FINISH_POSITION_POINTS':
      return { participantScoringDefinitionId, config: { pointsTable: [5, 3, 1], didNotFinishPoints: 0 } };
    case 'KNOCKOUT_ROUND_POINTS':
      return { participantScoringDefinitionId, config: { roundValues: [1, 2, 4, 8], upsetBonus: { rule: 'NONE' } } };
    default:
      return assertNever(participantScoringDefinitionId);
  }
}

/** An event of each family: one of a sport whose leagues are seeded with it. */
const EVENT_BY_SCORING_FAMILY = new Map<ScoringFamily, SportLeagueEvent>(
  Object.values(SPORT_DEFINITIONS).map((definition) => [sportPlay(definition.sport).scoringFamily, { sport: definition.sport, ...sportPlay(definition.sport) }] as const),
);

describe.each(Object.values(ScoringFamily))('scoring family %s', (family) => {
  const module = getScoringFamilyModule(family);
  // A family is only reached through an event whose sport names it, so it is exercised as one.
  const event = expectDefined(EVENT_BY_SCORING_FAMILY.get(family), `an event scored by ${family}`);

  it('scores an empty field as no participants', () => {
    expect(module.scoreField([], { ...event, roundCount: 4, status: SportEventStatus.IN_PROGRESS, slotDefinitions: [] }, defaultScoring(event), { slotDefinitionIds: null })).toEqual([]);
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
  it('accepts game scores, and only game scores, so the score publisher skips a golf batch for a bracket event (#1496)', () => {
    expect(getScoringFamilyModule(ScoringFamily.HEAD_TO_HEAD).liveScores?.category).toBe('GAME');
  });

  it('writes a GAME batch against the event\'s own matches and Games, reading each once, and reports a batch with no games as nothing written', async () => {
    const writer = getScoringFamilyModule(ScoringFamily.HEAD_TO_HEAD).liveScores;
    if (writer?.category !== 'GAME') throw new Error('head to head takes GAME live scores');
    const findMany = jest.fn().mockResolvedValue([]);
    const findGames = jest.fn().mockResolvedValue([]);

    const result = await writer.persist(
      { contestActivation: NO_CONTEST_ACTIVATION, prisma: { sportEventRoundMatch: { findMany }, sportEventRoundMatchGame: { findMany: findGames } } as unknown as PrismaClient, providerId: 'balldontlie', domainEvents: testDomainEvents() },
      { id: 'event-1' },
      { category: 'GAME', externalEventId: 'scope-1', games: [] },
    );

    expect(findMany).toHaveBeenCalledTimes(1);
    // The event's head-to-head matches: a FIELD match is read as its side results (#2008).
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sportEventId: { in: ['event-1'] }, NOT: FIELD_MATCH_WHERE } }));
    expect(findGames).toHaveBeenCalledTimes(1);
    expect(findGames).toHaveBeenCalledWith(expect.objectContaining({ where: { sportEventId: 'event-1' } }));
    expect(result).toMatchObject({ updatesReturned: 0, updatesPersisted: 0, updatesSkipped: 0 });
  });
});

describe('finish position', () => {
  it('accepts no live scores, so the score publisher skips any batch for a race', () => {
    expect(getScoringFamilyModule(ScoringFamily.FINISH_POSITION).liveScores).toBeNull();
  });
});

describe('scoring family registry', () => {
  it('resolves an event to the module of its sport league\'s scoring family, whatever the sport', () => {
    for (const family of Object.values(ScoringFamily)) {
      expect(scoringFamilyForEvent({ sport: Sport.GOLF, scoringFamily: family })).toBe(getScoringFamilyModule(family));
    }
  });
});
