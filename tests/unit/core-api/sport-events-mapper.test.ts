import type { SportEvent } from '@poolmaster/shared/domain';
import { mapSportEventToDto } from '../../../packages/core-api/src/mappers/sport-events.mapper';
import { EventService } from '../../../packages/core-api/src/modules/events/service';
import { fakeSportEventRepo } from '../../support/repo-fakes';

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

describe('SportEvent readiness on the wire', () => {
  it('is contest-eligible once released with a loaded field and before the field locks', () => {
    expect(mapSportEventToDto(event(), 72)).toMatchObject({
      loadedParticipantCount: 72,
      readinessStatus: 'CONTEST_ELIGIBLE',
      contestEligible: true,
      fieldLocked: false,
    });
  });

  it('is pending while no participant is loaded, even when the provider reports a field size', () => {
    expect(mapSportEventToDto(event(), 0)).toMatchObject({
      participantCount: 144,
      readinessStatus: 'PENDING_FIELD',
      readinessReasons: ['FIELD_NOT_LOADED'],
      contestEligible: false,
    });
  });

  it('reports the field locked when the provider has locked it, before fieldLocksAt', () => {
    expect(mapSportEventToDto(event({ fieldLocked: true }), 72)).toMatchObject({
      fieldLocked: true,
      readinessStatus: 'FIELD_LOCKED',
      contestEligible: false,
    });
  });

  it('carries null, not undefined, for absent optional columns', () => {
    expect(mapSportEventToDto(event(), 1)).toMatchObject({
      venue: null,
      location: null,
      endDate: null,
      rounds: null,
      seasonId: null,
      leagueEventId: null,
    });
  });
});

describe('EventService.listEvents', () => {
  it('pairs each event with its loaded participant count, zero where none are loaded', async () => {
    const service = new EventService(fakeSportEventRepo({
      findAll: jest.fn().mockResolvedValue([event({ id: 'e-1' }), event({ id: 'e-2' })]),
      countParticipants: jest.fn().mockResolvedValue(new Map([['e-1', 72]])),
    }));

    const rows = await service.listEvents({});

    expect(rows.map((row) => [row.event.id, row.loadedParticipantCount])).toEqual([['e-1', 72], ['e-2', 0]]);
  });
});
