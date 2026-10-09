import { expect } from '@jest/globals';
import { MappingConfidence, ParticipantStatus, InjuryStatusCode } from '@poolmaster/shared/domain';
import type { ParticipantRepository } from '@poolmaster/shared/db';
import { createParticipantHandlers } from '../../../packages/core-api/src/modules/participants/handler';
import {
  ParticipantNotFoundError,
  ParticipantService,
} from '../../../packages/core-api/src/modules/participants/service';
import { mockFn } from '../../support/mock-fn';

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
    role: 'GOLFER',
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
      create: mockFn<ParticipantRepository['create']>(async (input) => ({ ...buildParticipant(), ...input })),
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

  it('passes the text, the sport and the one status asked for to the participant search', async () => {
    const participantService = {
      search: jest.fn().mockResolvedValue([buildParticipant()]),
    } as unknown as ParticipantService;

    const handler = createParticipantHandlers(participantService, {} as never);

    const response = await handler.searchParticipants(
      {
        query: {
          q: 'scheffler',
          sportId: 'sport-1',
          status: 'RETIRED',
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
        status: 'RETIRED',
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

    const handler = createParticipantHandlers(participantService, {} as never);
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

  // #205 — binding a competitor a provider could not match (bindParticipantProviderMapping).
  describe('bindProviderMapping', () => {
    const mapping = {
      id: 'mapping-1',
      participantId: 'participant-1',
      providerId: 'mock-contest-feed',
      externalId: 'golfer-77',
      confidence: MappingConfidence.MANUAL,
      mappedAt: new Date('2026-09-30T12:00:00.000Z'),
    };

    it('binds the provider identity to an existing participant with MANUAL confidence', async () => {
      const participantRepo = { findById: jest.fn().mockResolvedValue(buildParticipant()) };
      const mappingRepo = { bind: jest.fn().mockResolvedValue(mapping) };
      const service = new ParticipantService(participantRepo as never, mappingRepo as never);

      await expect(service.bindProviderMapping('participant-1', 'mock-contest-feed', 'golfer-77'))
        .resolves.toEqual(mapping);
      expect(mappingRepo.bind).toHaveBeenCalledWith({
        participantId: 'participant-1',
        providerId: 'mock-contest-feed',
        externalId: 'golfer-77',
        confidence: MappingConfidence.MANUAL,
        mappedAt: expect.any(Date),
      });
    });

    it('refuses to bind to a participant that does not exist', async () => {
      const mappingRepo = { bind: jest.fn() };
      const service = new ParticipantService(
        { findById: jest.fn().mockResolvedValue(null) } as never,
        mappingRepo as never,
      );

      await expect(service.bindProviderMapping('missing', 'mock-contest-feed', 'golfer-77'))
        .rejects.toBeInstanceOf(ParticipantNotFoundError);
      expect(mappingRepo.bind).not.toHaveBeenCalled();
    });

    function bindRequest() {
      return {
        params: { id: 'participant-1' },
        body: { providerId: 'mock-contest-feed', externalId: 'golfer-77' },
      } as never;
    }

    function replyStub() {
      return { status: jest.fn().mockReturnThis(), send: jest.fn() };
    }

    it('answers 404 PROVIDER_NOT_FOUND for a provider that is not registered, before touching the participant', async () => {
      const participantService = { bindProviderMapping: jest.fn() } as unknown as ParticipantService;
      const reply = replyStub();
      const handler = createParticipantHandlers(participantService, {
        getProviderById: jest.fn().mockReturnValue(undefined),
      } as never);

      await handler.bindProviderMapping(bindRequest(), reply as never);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({
        error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider mock-contest-feed was not found.' },
      });
      expect(participantService.bindProviderMapping).not.toHaveBeenCalled();
    });

    it('answers 404 PARTICIPANT_NOT_FOUND when the participant is missing, and returns the mapping otherwise', async () => {
      const bind = jest.fn()
        .mockRejectedValueOnce(new ParticipantNotFoundError('participant-1'))
        .mockResolvedValueOnce(mapping);
      const handler = createParticipantHandlers(
        { bindProviderMapping: bind } as unknown as ParticipantService,
        { getProviderById: jest.fn().mockReturnValue({ providerId: 'mock-contest-feed' }) } as never,
      );

      const missingReply = replyStub();
      await handler.bindProviderMapping(bindRequest(), missingReply as never);
      expect(missingReply.status).toHaveBeenCalledWith(404);
      expect(missingReply.send).toHaveBeenCalledWith({
        error: { code: 'PARTICIPANT_NOT_FOUND', message: 'Participant not found: participant-1' },
      });

      const reply = replyStub();
      await handler.bindProviderMapping(bindRequest(), reply as never);
      expect(reply.send).toHaveBeenCalledWith({
        providerMapping: expect.objectContaining({
          id: 'mapping-1',
          participantId: 'participant-1',
          confidence: 'MANUAL',
          mappedAt: '2026-09-30T12:00:00.000Z',
        }),
      });
    });
  });
});
