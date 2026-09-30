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
  it('creates participants with default active and healthy state', async () => {
    const participantRepo = {
      create: jest.fn().mockImplementation(async (input) => buildParticipant(input)),
    };

    const service = new ParticipantService(
      participantRepo as never,
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
    );

    await expect(service.update('missing-participant', { name: 'Updated' })).rejects.toBeInstanceOf(
      ParticipantNotFoundError,
    );
  });

  it('splits comma-separated participant filters into lists for the search', async () => {
    const participantService = {
      search: jest.fn().mockResolvedValue([buildParticipant()]),
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
    });
    expect(response.participants).toHaveLength(1);
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
});
