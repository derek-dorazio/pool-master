import { ParticipantStatus, InjuryStatusCode } from '@poolmaster/shared/domain';
import { createParticipantHandlers } from '../../../packages/core-api/src/modules/participants/handler';
import {
  ParticipantNotFoundError,
  ParticipantService,
} from '../../../packages/core-api/src/modules/participants/service';

function buildParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'participant-1',
    sportId: 'sport-1',
    name: 'Scottie Scheffler',
    participantType: 'INDIVIDUAL' as const,
    externalId: 'provider-1',
    metadata: {},
    firstName: 'Scottie',
    lastName: 'Scheffler',
    shortName: 'Scheffler',
    nationality: 'USA',
    position: 'GOLFER',
    teamAffiliation: undefined,
    status: ParticipantStatus.ACTIVE,
    injuryStatus: { status: InjuryStatusCode.HEALTHY },
    photoUrl: undefined,
    photoLastUpdated: undefined,
    externalIds: {},
    createdAt: new Date('2026-04-10T12:00:00.000Z'),
    updatedAt: new Date('2026-04-10T12:00:00.000Z'),
    ...overrides,
  };
}

describe('participant service and handler', () => {
  it('clamps participant search limit and defaults offset', async () => {
    const participantRepo = {
      search: jest.fn().mockResolvedValue({ participants: [], total: 0 }),
    };

    const service = new ParticipantService(
      participantRepo as never,
      {} as never,
      {} as never,
    );

    await service.search({
      query: 'scheffler',
      filters: {},
      limit: 999,
    });

    expect(participantRepo.search).toHaveBeenCalledWith('scheffler', {}, 200, 0);
  });

  it('creates participants with default active and healthy state', async () => {
    const participantRepo = {
      create: jest.fn().mockImplementation(async (input) => buildParticipant(input)),
    };

    const service = new ParticipantService(
      participantRepo as never,
      {} as never,
      {} as never,
    );

    const participant = await service.create({
      sportId: 'sport-1',
      name: 'Scottie Scheffler',
      participantType: 'INDIVIDUAL',
    });

    expect(participantRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ParticipantStatus.ACTIVE,
        injuryStatus: { status: InjuryStatusCode.HEALTHY },
        metadata: {},
        externalIds: {},
      }),
    );
    expect(participant.status).toBe(ParticipantStatus.ACTIVE);
  });

  it('throws ParticipantNotFoundError when update target is missing', async () => {
    const participantRepo = {
      findById: jest.fn().mockResolvedValue(null),
    };

    const service = new ParticipantService(
      participantRepo as never,
      {} as never,
      {} as never,
    );

    await expect(service.update('missing-participant', { name: 'Updated' })).rejects.toBeInstanceOf(
      ParticipantNotFoundError,
    );
  });

  it('parses participant search filters and numeric paging in the handler', async () => {
    const participantService = {
      search: jest.fn().mockResolvedValue({
        participants: [buildParticipant()],
        total: 1,
      }),
    } as unknown as ParticipantService;

    const handler = createParticipantHandlers(participantService);

    const response = await handler.searchParticipants(
      {
        query: {
          q: 'scheffler',
          sportId: 'sport-1',
          status: 'ACTIVE,RETIRED',
          position: 'GOLFER',
          team: 'USA',
          nationality: 'US',
          limit: '5',
          offset: '10',
        },
        contextLogger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
        log: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
      } as never,
      {} as never,
    );

    expect(participantService.search).toHaveBeenCalledWith({
      query: 'scheffler',
      filters: {
        sportId: 'sport-1',
        status: ['ACTIVE', 'RETIRED'],
        position: ['GOLFER'],
        teamAffiliation: ['USA'],
        nationality: ['US'],
      },
      limit: 5,
      offset: 10,
    });
    expect(response.total).toBe(1);
  });

  it('returns a normalized 404 envelope when participant detail is missing', async () => {
    const participantService = {
      findById: jest.fn().mockResolvedValue(null),
    } as unknown as ParticipantService;
    const reply = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    const handler = createParticipantHandlers(participantService);
    await handler.getParticipant(
      {
        params: { id: 'missing-participant' },
        contextLogger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      } as never,
      reply as never,
    );

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'PARTICIPANT_NOT_FOUND',
        message: 'Participant not found',
      },
    });
  });

  it('returns a normalized 404 envelope when a season record is missing', async () => {
    const participantService = {
      getSeasonRecord: jest.fn().mockResolvedValue(null),
    } as unknown as ParticipantService;
    const reply = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    const handler = createParticipantHandlers(participantService);
    await handler.getSeasonRecord(
      {
        params: { id: 'participant-1', season: '2026' },
        contextLogger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      } as never,
      reply as never,
    );

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'PARTICIPANT_SEASON_RECORD_NOT_FOUND',
        message: 'Season record not found',
      },
    });
  });
});
