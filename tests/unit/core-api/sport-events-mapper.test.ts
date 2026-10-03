import type { SportEvent } from '@poolmaster/shared/domain';
import { mapSportEventToDto } from '../../../packages/core-api/src/mappers/sport-events.mapper';

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    externalId: 'mock-major-2026',
    providerId: 'mock-contest-feed',
    sport: 'GOLF',
    name: 'Mock Major',
    status: 'SCHEDULED',
    startDate: new Date('2026-04-12T16:00:00.000Z'),
    releaseAt: new Date('2000-01-01T00:00:00.000Z'),
    fieldLocksAt: new Date('2999-01-01T00:00:00.000Z'),
    fieldLocked: false,
    participantCount: 144,
    metadata: {},
    syncScope: 'FULL',
    autoLifecycleEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  } as SportEvent;
}

function summary(sportEvent: SportEvent, loadedParticipantCount: number) {
  return { event: sportEvent, loadedParticipantCount, tierCount: 0, contestCount: 0 };
}

describe('SportEvent readiness on the wire', () => {
  it('is contest-eligible once released with a loaded field and before the field locks', () => {
    expect(mapSportEventToDto(summary(event(), 72))).toMatchObject({
      loadedParticipantCount: 72,
      readinessStatus: 'CONTEST_ELIGIBLE',
      contestEligible: true,
      fieldLocked: false,
    });
  });

  it('is pending while no participant is loaded, even when the provider reports a field size', () => {
    expect(mapSportEventToDto(summary(event(), 0))).toMatchObject({
      participantCount: 144,
      readinessStatus: 'PENDING_FIELD',
      readinessReasons: ['FIELD_NOT_LOADED'],
      contestEligible: false,
    });
  });

  it('reports the field locked when the provider has locked it, before fieldLocksAt', () => {
    expect(mapSportEventToDto(summary(event({ fieldLocked: true }), 72))).toMatchObject({
      fieldLocked: true,
      readinessStatus: 'FIELD_LOCKED',
      contestEligible: false,
    });
  });

  it('carries null, not undefined, for absent optional columns', () => {
    expect(mapSportEventToDto(summary(event(), 1))).toMatchObject({
      venue: null,
      location: null,
      endDate: null,
      rounds: null,
      seasonId: null,
      eventSeriesId: null,
    });
  });
});

describe('SportEvent next statuses on the wire', () => {
  it('carries the declared transitions from the event\'s current status, and its counts', () => {
    expect(mapSportEventToDto({ event: event({ status: 'SCHEDULED' }), loadedParticipantCount: 0, tierCount: 6, contestCount: 2 })).toMatchObject({
      allowedTransitions: ['IN_PROGRESS', 'POSTPONED', 'CANCELLED'],
      tierCount: 6,
      contestCount: 2,
    });
    expect(mapSportEventToDto(summary(event({ status: 'COMPLETED' }), 0)).allowedTransitions).toEqual([]);
  });
});
