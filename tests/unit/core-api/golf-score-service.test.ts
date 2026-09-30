/**
 * Unit tests for GolfScoreService's logic that needs no stored state: resolving an
 * upload row to a field golfer (participantId, then Participant.externalId, then an
 * exact case-insensitive playerName, ambiguous when several match), the null-score
 * read before a round is scheduled, and the 404 for a wrong-event field entry.
 *
 * Everything that reads or writes round and standing rows — preview change detection,
 * apply, patch, standing refresh — is asserted against Postgres in
 * tests/integration/core-api/golf-round-scores.integration.ts, where the core row /
 * golf extension split is observable.
 */import { GolfScoreService } from '../../../packages/core-api/src/modules/golf/golf-score-service';

function buildPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    sportEventRound: {
      findUnique: jest.fn().mockResolvedValue({ id: 'round-1', sportEventId: 'event-1', roundNumber: 1 }),
      upsert: jest.fn().mockResolvedValue({ id: 'round-1', sportEventId: 'event-1', roundNumber: 1 }),
    },
    sportEventParticipant: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    participant: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    sportEventParticipantRound: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    sportEvent: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ providerId: 'mock-golf' }),
    },
    $transaction: jest.fn().mockImplementation((arg) => (
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg)
    )),
    ...overrides,
  };
  return prisma;
}

describe('GolfScoreService.resolveFieldParticipant', () => {
  it('pool-master-blj matches directly by participantId', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', participant: { name: 'Rory McIlroy' } }),
      },
    });
    const service = new GolfScoreService(prisma as any);

    const result = await service.resolveFieldParticipant({ participantId: 'p-1' }, { sportEventId: 'event-1' });

    expect(prisma.sportEventParticipant.findUnique).toHaveBeenCalledWith({
      where: { sportEventId_participantId: { sportEventId: 'event-1', participantId: 'p-1' } },
      include: { participant: { select: { name: true } } },
    });
    expect(result).toEqual({ resolution: 'MATCHED', sportEventParticipantId: 'sep-1', participantName: 'Rory McIlroy' });
  });

  it('pool-master-blj is UNRESOLVED when participantId is given but not in this field', async () => {
    const prisma = buildPrisma();
    const service = new GolfScoreService(prisma as any);

    const result = await service.resolveFieldParticipant({ participantId: 'missing' }, { sportEventId: 'event-1' });

    expect(result.resolution).toBe('UNRESOLVED');
  });

  it('pool-master-blj resolves externalId against the bare Participant.externalId field, not a provider mapping', async () => {
    const prisma = buildPrisma({
      participant: { findFirst: jest.fn().mockResolvedValue({ id: 'p-1' }) },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', participant: { name: 'Rory McIlroy' } }),
      },
    });
    const service = new GolfScoreService(prisma as any);

    const result = await service.resolveFieldParticipant({ externalId: 'ext-1' }, { sportEventId: 'event-1' });

    expect(prisma.participant.findFirst).toHaveBeenCalledWith({ where: { externalId: 'ext-1' } });
    expect(result).toEqual({ resolution: 'MATCHED', sportEventParticipantId: 'sep-1', participantName: 'Rory McIlroy' });
  });

  it('pool-master-blj is UNRESOLVED when externalId matches no Participant at all', async () => {
    const prisma = buildPrisma();
    const service = new GolfScoreService(prisma as any);

    const result = await service.resolveFieldParticipant({ externalId: 'missing' }, { sportEventId: 'event-1' });

    expect(result.resolution).toBe('UNRESOLVED');
    expect(prisma.sportEventParticipant.findUnique).not.toHaveBeenCalled();
  });

  it('pool-master-blj matches an exact case-insensitive playerName within the field', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sep-1', participant: { name: 'Rory McIlroy' } }]),
      },
    });
    const service = new GolfScoreService(prisma as any);

    const result = await service.resolveFieldParticipant({ playerName: 'rory mcilroy' }, { sportEventId: 'event-1' });

    expect(prisma.sportEventParticipant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sportEventId: 'event-1', participant: { name: { equals: 'rory mcilroy', mode: 'insensitive' } } },
    }));
    expect(result).toEqual({ resolution: 'MATCHED', sportEventParticipantId: 'sep-1', participantName: 'Rory McIlroy' });
  });

  it('pool-master-blj is AMBIGUOUS when more than one field participant matches the playerName', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'sep-1', participant: { name: 'Jordan Smith' } },
          { id: 'sep-2', participant: { name: 'Jordan Smith' } },
        ]),
      },
    });
    const service = new GolfScoreService(prisma as any);

    const result = await service.resolveFieldParticipant({ playerName: 'Jordan Smith' }, { sportEventId: 'event-1' });

    expect(result.resolution).toBe('AMBIGUOUS');
  });

  it('pool-master-blj is UNRESOLVED when no identifier is supplied at all', async () => {
    const prisma = buildPrisma();
    const service = new GolfScoreService(prisma as any);

    const result = await service.resolveFieldParticipant({}, { sportEventId: 'event-1' });

    expect(result.resolution).toBe('UNRESOLVED');
  });
});

describe('GolfScoreService.getRoundScores', () => {
  it('pool-master-blj returns every field row with null scores when the round has no schedule row yet', async () => {
    const prisma = buildPrisma({
      sportEventRound: { findUnique: jest.fn().mockResolvedValue(null) },
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'sep-1', participantId: 'p-1', participant: { name: 'Rory McIlroy' }, golfStanding: null },
        ]),
      },
    });
    const service = new GolfScoreService(prisma as any);

    const result = await service.getRoundScores('event-1', 3);

    expect(result).toEqual([expect.objectContaining({ strokes: null, status: null })]);
  });
});

describe('GolfScoreService.updateRoundScore', () => {
  it('pool-master-blj throws 404 FIELD_ENTRY_NOT_FOUND when the sportEventParticipantId is missing or belongs to a different event', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: { findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', sportEventId: 'other-event' }) },
    });
    const service = new GolfScoreService(prisma as any);

    await expect(service.updateRoundScore('event-1', 1, 'sep-1', { strokes: 70 }))
      .rejects.toMatchObject({ code: 'FIELD_ENTRY_NOT_FOUND', statusCode: 404 });
  });

});
