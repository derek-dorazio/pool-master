/**
 * Unit tests for GolfScoreService (pool-master-blj / plans/124 §3.1/§4.10/§5.2).
 *
 * `persistRoundUpdatesForSportEvent` (the sync path, moved verbatim from
 * score-publisher.ts's former persistGolfRounds/refreshGolfStandings) is
 * exercised end to end by score-publisher.test.ts through
 * publishLiveScoreUpdate — all 10 of those pre-existing tests pass unchanged
 * against this extraction, so this file focuses on the new admin-facing
 * surface instead of re-verifying that logic here.
 *
 * Coverage:
 *   - resolveFieldParticipant: participantId direct match; externalId
 *     against the bare Participant.externalId field; exact case-insensitive
 *     playerName match, ambiguous when more than one matches; unresolved
 *     when none of the three identifiers are supplied or none match.
 *   - getRoundScores: merges field rows with the round's existing scores
 *     and current standing, defaulting to null when neither exists yet.
 *   - previewRoundScores: CREATE/UPDATE/UNCHANGED change detection; writes
 *     nothing.
 *   - applyRoundScores: 422 ROUND_SCORE_ROWS_UNRESOLVED when any row is
 *     unresolved (all-or-nothing, no partial writes); skips null-strokes
 *     rows the same way the sync path does; refreshes standings and
 *     publishes live_score.persisted on success.
 *   - updateRoundScore: 404 FIELD_ENTRY_NOT_FOUND for a missing/wrong-event
 *     sportEventParticipantId; partial-patches an existing round row.
 */
import { GolfScoreError, GolfScoreService, type GolfScoreRowInput } from '../../../packages/core-api/src/modules/golf/golf-score-service';

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
    sportEventParticipantGolfRound: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'golf-round-1' }),
    },
    sportEventParticipantGolfStanding: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: 'standing-1' }),
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
  it('pool-master-blj merges field rows with existing round scores and standings', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sep-1',
            participantId: 'p-1',
            participant: { name: 'Rory McIlroy' },
            golfStanding: { eventScoreToPar: -3, eventStrokes: 69, currentRound: 1, currentRoundThru: 18, status: 'ACTIVE' },
          },
          { id: 'sep-2', participantId: 'p-2', participant: { name: 'Jordan Spieth' }, golfStanding: null },
        ]),
      },
      sportEventParticipantGolfRound: {
        findMany: jest.fn().mockResolvedValue([
          { sportEventParticipantId: 'sep-1', strokes: 69, scoreToPar: -3, thru: 18, status: 'COMPLETED', completedAt: null },
        ]),
      },
    });
    const service = new GolfScoreService(prisma as any);

    const result = await service.getRoundScores('event-1', 1);

    expect(result).toEqual([
      expect.objectContaining({
        sportEventParticipantId: 'sep-1',
        strokes: 69,
        scoreToPar: -3,
        standing: expect.objectContaining({ eventScoreToPar: -3 }),
      }),
      expect.objectContaining({
        sportEventParticipantId: 'sep-2',
        strokes: null,
        scoreToPar: null,
        standing: null,
      }),
    ]);
  });

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

    expect(prisma.sportEventParticipantGolfRound.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ strokes: null, status: null })]);
  });
});

describe('GolfScoreService.previewRoundScores', () => {
  function buildRow(overrides: Partial<GolfScoreRowInput> = {}): GolfScoreRowInput {
    return { strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED', ...overrides };
  }

  it('pool-master-blj reports CREATE when the participant resolves but has no existing round row', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', participant: { name: 'Rory McIlroy' } }),
      },
    });
    const service = new GolfScoreService(prisma as any);

    const [result] = await service.previewRoundScores('event-1', 1, [buildRow({ participantId: 'p-1' })]);

    expect(result).toEqual(expect.objectContaining({ resolution: 'MATCHED', change: 'CREATE', before: null }));
  });

  it('pool-master-blj reports UNCHANGED when the resolved row matches the existing round values exactly', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', participant: { name: 'Rory McIlroy' } }),
      },
      sportEventParticipantGolfRound: {
        findMany: jest.fn().mockResolvedValue([
          { sportEventParticipantId: 'sep-1', strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED' },
        ]),
      },
    });
    const service = new GolfScoreService(prisma as any);

    const [result] = await service.previewRoundScores('event-1', 1, [buildRow({ participantId: 'p-1' })]);

    expect(result.change).toBe('UNCHANGED');
  });

  it('pool-master-blj reports UPDATE when the resolved row differs from the existing round values', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', participant: { name: 'Rory McIlroy' } }),
      },
      sportEventParticipantGolfRound: {
        findMany: jest.fn().mockResolvedValue([
          { sportEventParticipantId: 'sep-1', strokes: 72, scoreToPar: 0, thru: 18, status: 'COMPLETED' },
        ]),
      },
    });
    const service = new GolfScoreService(prisma as any);

    const [result] = await service.previewRoundScores('event-1', 1, [buildRow({ participantId: 'p-1' })]);

    expect(result.change).toBe('UPDATE');
    expect(result.before).toEqual(expect.objectContaining({ strokes: 72 }));
  });

  it('pool-master-blj passes an UNRESOLVED/AMBIGUOUS resolution through with change=CREATE and before=null, without a fake match', async () => {
    const prisma = buildPrisma();
    const service = new GolfScoreService(prisma as any);

    const [result] = await service.previewRoundScores('event-1', 1, [buildRow({ playerName: 'Nobody Here' })]);

    expect(result).toEqual(expect.objectContaining({
      resolution: 'UNRESOLVED',
      sportEventParticipantId: null,
      change: 'CREATE',
      before: null,
    }));
  });
});

describe('GolfScoreService.applyRoundScores', () => {
  function buildRow(overrides: Partial<GolfScoreRowInput> = {}): GolfScoreRowInput {
    return { participantId: 'p-1', strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED', ...overrides };
  }

  it('pool-master-blj throws 422 ROUND_SCORE_ROWS_UNRESOLVED and writes nothing when any row is unresolved', async () => {
    const prisma = buildPrisma();
    const service = new GolfScoreService(prisma as any);

    await expect(service.applyRoundScores('event-1', 1, [buildRow({ participantId: 'missing' })]))
      .rejects.toMatchObject({ code: 'ROUND_SCORE_ROWS_UNRESOLVED', statusCode: 422 });
    expect(prisma.sportEventParticipantGolfRound.upsert).not.toHaveBeenCalled();
    await expect(service.applyRoundScores('event-1', 1, [buildRow({ participantId: 'missing' })]))
      .rejects.toBeInstanceOf(GolfScoreError);
  });

  it('pool-master-blj persists resolved rows, refreshes standings, publishes live_score.persisted, and returns the refreshed rows', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', participant: { name: 'Rory McIlroy' } }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'sep-1', participantId: 'p-1', participant: { name: 'Rory McIlroy' }, golfStanding: null },
        ]),
      },
      sportEventParticipantGolfRound: {
        findMany: jest.fn()
          .mockResolvedValueOnce([]) // preview's existing-rows lookup
          .mockResolvedValueOnce([{ sportEventParticipantId: 'sep-1', strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED', sportEventRound: { roundNumber: 1 } }]) // refreshGolfStandings
          .mockResolvedValueOnce([{ sportEventParticipantId: 'sep-1', strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED', completedAt: null }]), // final getRoundScores
        upsert: jest.fn().mockResolvedValue({ id: 'golf-round-1' }),
      },
    });
    const bus = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new GolfScoreService(prisma as any, undefined, bus as any);

    const result = await service.applyRoundScores('event-1', 1, [buildRow()]);

    expect(prisma.sportEventParticipantGolfRound.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sportEventParticipantId_sportEventRoundId: { sportEventParticipantId: 'sep-1', sportEventRoundId: 'round-1' } },
      create: expect.objectContaining({ strokes: 68, scoreToPar: -4 }),
    }));
    expect(prisma.sportEventParticipantGolfStanding.upsert).toHaveBeenCalled();
    expect(bus.publish).toHaveBeenCalledWith('live_score.persisted', expect.objectContaining({
      type: 'live_score.persisted',
      category: 'GOLF',
      providerId: 'mock-golf',
      sportEventId: 'event-1',
      updatesPersisted: 1,
    }));
    expect(result).toEqual([expect.objectContaining({ sportEventParticipantId: 'sep-1' })]);
  });

  it('pool-master-blj skips a resolved row with null strokes, matching the sync path\'s null-strokes skip', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', participant: { name: 'Rory McIlroy' } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const bus = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new GolfScoreService(prisma as any, undefined, bus as any);

    await service.applyRoundScores('event-1', 1, [buildRow({ strokes: null })]);

    expect(prisma.sportEventParticipantGolfRound.upsert).not.toHaveBeenCalled();
    expect(prisma.sportEventParticipantGolfStanding.upsert).not.toHaveBeenCalled();
    expect(bus.publish).toHaveBeenCalledWith('live_score.persisted', expect.objectContaining({ updatesPersisted: 0 }));
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

  it('pool-master-blj patches only the supplied fields and returns the refreshed row', async () => {
    const prisma = buildPrisma({
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', sportEventId: 'event-1' }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'sep-1', participantId: 'p-1', participant: { name: 'Rory McIlroy' }, golfStanding: null },
        ]),
      },
      sportEventParticipantGolfRound: {
        findMany: jest.fn()
          .mockResolvedValueOnce([
            { sportEventParticipantId: 'sep-1', strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED', sportEventRound: { roundNumber: 1 } },
          ]) // refreshGolfStandings
          .mockResolvedValueOnce([
            { sportEventParticipantId: 'sep-1', strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED', completedAt: null },
          ]), // final getRoundScores
        upsert: jest.fn().mockResolvedValue({ id: 'golf-round-1' }),
      },
    });
    const service = new GolfScoreService(prisma as any);

    await service.updateRoundScore('event-1', 1, 'sep-1', { strokes: 70 });

    expect(prisma.sportEventParticipantGolfRound.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { strokes: 70 },
    }));
  });
});
