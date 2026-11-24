import { expect } from '@jest/globals';
import { ParticipantStatus, InjuryStatusCode } from '@poolmaster/shared/domain';
import type { ParticipantRepository } from '@poolmaster/shared/db';
import {
  ParticipantNotFoundError,
  ParticipantService,
  ProviderNotFoundError,
} from '../../../packages/core-api/src/modules/participants/service';
import { mockFn } from '../../support/mock-fn';
import { BALLDONTLIE_TEST_PROVIDER_ID as PROVIDER_ROW_ID } from '../../support/balldontlie-provider-rows';

function buildParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'participant-1',
    sportLeagueId: 'league-1',
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
      sportLeagueId: 'league-1',
      name: 'Scottie Scheffler',
      participantType: 'INDIVIDUAL',
    });

    expect(participantRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ParticipantStatus.ACTIVE,
        injuryStatus: { status: InjuryStatusCode.HEALTHY },
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
      sportLeagueId: 'league-1',
      participantType: 'INDIVIDUAL',
      providerId: PROVIDER_ROW_ID,
      providerName: 'BALLDONTLIE',
      externalId: 'golfer-77',
      mappedAt: new Date('2026-09-30T12:00:00.000Z'),
    };

    it('binds the provider identity to an existing participant, in its own sport league and of its own kind', async () => {
      const participantRepo = { findById: jest.fn().mockResolvedValue(buildParticipant()) };
      const mappingRepo = { bind: jest.fn().mockResolvedValue(mapping) };
      const service = new ParticipantService(participantRepo as never, mappingRepo as never);

      await expect(service.bindProviderMapping('participant-1', PROVIDER_ROW_ID, 'golfer-77'))
        .resolves.toEqual(mapping);
      // In the participant's own sport league (#1853).
      expect(mappingRepo.bind).toHaveBeenCalledWith({
        participantId: 'participant-1',
        sportLeagueId: 'league-1',
        participantType: 'INDIVIDUAL',
        providerId: PROVIDER_ROW_ID,
        externalId: 'golfer-77',
        mappedAt: expect.any(Date),
      });
    });

    it('refuses with ProviderNotFoundError a provider id that names no Provider row', async () => {
      const participantRepo = { findById: jest.fn().mockResolvedValue(buildParticipant()) };
      const mappingRepo = { bind: jest.fn().mockResolvedValue(null) };
      const service = new ParticipantService(participantRepo as never, mappingRepo as never);

      await expect(service.bindProviderMapping('participant-1', PROVIDER_ROW_ID, 'golfer-77'))
        .rejects.toBeInstanceOf(ProviderNotFoundError);
    });

    it('refuses to bind to a participant that does not exist', async () => {
      const mappingRepo = { bind: jest.fn() };
      const service = new ParticipantService(
        { findById: jest.fn().mockResolvedValue(null) } as never,
        mappingRepo as never,
      );

      await expect(service.bindProviderMapping('missing', PROVIDER_ROW_ID, 'golfer-77'))
        .rejects.toBeInstanceOf(ParticipantNotFoundError);
      expect(mappingRepo.bind).not.toHaveBeenCalled();
    });
  });
});
