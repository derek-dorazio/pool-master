import type { SportEvent } from '@poolmaster/shared/domain';
import { mapSportEventToDto } from '../../../packages/core-api/src/mappers/sport-events.mapper';
import { standardEventPricing } from '../../support/budget-pricing';

function event(overrides: Partial<SportEvent> = {}): SportEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    externalId: 'mock-major-2026',
    providerId: 'mock-contest-feed',
    sport: 'GOLF',
    name: 'Mock Major',
    status: 'SCHEDULED',
    // Far ahead, so the mapper's own clock always reads it as not yet started.
    startDate: new Date('2999-04-12T16:00:00.000Z'),
    participantCount: 144,
    metadata: {},
    eventSeriesId: '22222222-2222-4222-8222-222222222222',
    eventYear: 2026,
    sportLeagueId: '33333333-3333-4333-8333-333333333333',
    syncScope: 'SCORES_ONLY',
    autoLifecycleEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  } as SportEvent;
}

function summary(sportEvent: SportEvent, loadedParticipantCount: number, untieredParticipantCount = 0) {
  return { event: sportEvent, loadedParticipantCount, untieredParticipantCount, unpricedParticipantCount: 0, tierCount: 0, contestCount: 0 };
}

describe('SportEvent pricing on the wire (#93)', () => {
  it('carries the values the field was priced with, whose salary cap every budget contest on the event uses', () => {
    const pricing = standardEventPricing();

    expect(mapSportEventToDto(summary(event({ pricingConfig: pricing }), 72)).pricing).toEqual(pricing);
  });

  it('carries null pricing for an event whose prices were never assigned', () => {
    expect(mapSportEventToDto(summary(event(), 72)).pricing).toBeNull();
  });
});

describe('SportEvent readiness on the wire', () => {
  it('is contest-eligible once released with a loaded field and before it starts', () => {
    expect(mapSportEventToDto(summary(event(), 72))).toMatchObject({
      loadedParticipantCount: 72,
      readinessStatus: 'CONTEST_ELIGIBLE',
      contestEligible: true,
    });
  });

  it('is not released while the event is a draft, and carries how many active participants have no tier', () => {
    expect(mapSportEventToDto(summary(event({ status: 'DRAFT' }), 72, 5))).toMatchObject({
      status: 'DRAFT',
      untieredParticipantCount: 5,
      readinessStatus: 'NOT_RELEASED',
      readinessReasons: ['EVENT_NOT_RELEASED'],
      contestEligible: false,
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

  it('reports a released event whose start time has passed as started', () => {
    expect(mapSportEventToDto(summary(event({ startDate: new Date('2000-04-12T16:00:00.000Z') }), 72))).toMatchObject({
      readinessStatus: 'EVENT_STARTED',
      contestEligible: false,
    });
  });

  it('carries null, not undefined, for absent optional columns', () => {
    expect(mapSportEventToDto(summary(event(), 1))).toMatchObject({
      venue: null,
      location: null,
      endDate: null,
      rounds: null,
    });
  });

  // plans/147 — the series, its year and the sport league reached through the series are
  // always present: an event has exactly one parent.
  it('carries the event\'s series, its event year and its sport league', () => {
    expect(mapSportEventToDto(summary(event(), 1))).toMatchObject({
      eventSeriesId: '22222222-2222-4222-8222-222222222222',
      eventYear: 2026,
      sportLeagueId: '33333333-3333-4333-8333-333333333333',
    });
  });
});

describe('SportEvent next statuses on the wire', () => {
  it('carries the declared transitions from the event\'s current status, and its counts', () => {
    expect(mapSportEventToDto({ event: event({ status: 'SCHEDULED' }), loadedParticipantCount: 0, untieredParticipantCount: 0, unpricedParticipantCount: 0, tierCount: 6, contestCount: 2 })).toMatchObject({
      allowedTransitions: ['IN_PROGRESS', 'POSTPONED', 'CANCELLED'],
      tierCount: 6,
      contestCount: 2,
    });
    expect(mapSportEventToDto(summary(event({ status: 'COMPLETED' }), 0)).allowedTransitions).toEqual([]);
  });

  it('does not offer SCHEDULED from a draft: releasing it is its own action (#431)', () => {
    expect(mapSportEventToDto(summary(event({ status: 'DRAFT' }), 0)).allowedTransitions).toEqual(['CANCELLED']);
  });
});
