import { expect } from '@jest/globals';
import { MappingConfidence, ParticipantStatus, InjuryStatusCode } from '@poolmaster/shared/domain';
import type { ParticipantRepository } from '@poolmaster/shared/db';
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

describe('participant service', () => {
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
  });
});
