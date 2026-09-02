/**
 * Unit tests for GolfFieldService (pool-master-6jk / plans/124 §4.2/§4.7/§5.2).
 *
 * Coverage:
 *   - seedFieldFromLeagueRoster: 409 TOURNAMENT_HAS_NO_SEASON when the event
 *     has no season; filters the roster to ACTIVE participants; skips
 *     already-in-field participants (idempotent); derives seedNumber/
 *     oddsToWin only for participants actually being added.
 *   - bulkAddFieldEntries: cross-league invite path, idempotent skip of
 *     already-present participantIds, no derivation.
 *   - bulkUpdateFieldEntries: 404 FIELD_ENTRY_NOT_FOUND for an entry not on
 *     this event; writes SportEventParticipantGolfValuation.price with
 *     priceAssignedSource=MANUAL when price is present.
 *   - removeFieldEntry: 404 when missing/wrong-event, 409
 *     FIELD_ENTRY_HAS_PICKS when a ContestEntryPick references it.
 *   - listField: projects isLeagueRosterMember from the current league roster.
 */
import { GolfFieldService } from '../../../packages/core-api/src/modules/golf/golf-field-service';

function buildFieldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sep-1',
    participantId: 'p-1',
    isActive: true,
    inactiveReason: null,
    worldRanking: 5,
    oddsToWin: 12.5,
    seedNumber: 3,
    participant: { name: 'Rory McIlroy', shortName: 'R. McIlroy', nationality: 'NIR' },
    golfValuation: null,
    ...overrides,
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  return {
    prisma: {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: 'season-1' }),
      },
      season: {
        findUnique: jest.fn().mockResolvedValue({ sportLeagueId: 'league-1' }),
      },
      sportEventParticipant: {
        findMany: jest.fn().mockResolvedValue([buildFieldRow()]),
        findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', sportEventId: 'event-1' }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      contestEntryPick: {
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    },
    sportLeagueService: {
      getRoster: jest.fn().mockResolvedValue([
        { participantId: 'p-1', name: 'Rory McIlroy', shortName: 'R. McIlroy', nationality: 'NIR', status: 'ACTIVE', worldRanking: 5 },
      ]),
    },
    random: () => 0.5,
    ...overrides,
  };
}

describe('GolfFieldService.listField', () => {
  it('pool-master-6jk projects isLeagueRosterMember from the tournament\'s current league roster', async () => {
    const deps = buildDeps();
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.listField('event-1');

    expect(result).toEqual([
      expect.objectContaining({
        sportEventParticipantId: 'sep-1',
        participantId: 'p-1',
        participantName: 'Rory McIlroy',
        isLeagueRosterMember: true,
      }),
    ]);
  });

  it('pool-master-6jk sets isLeagueRosterMember false for a golfer not on the league roster', async () => {
    const deps = buildDeps({
      sportLeagueService: { getRoster: jest.fn().mockResolvedValue([]) },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.listField('event-1');

    expect(result[0].isLeagueRosterMember).toBe(false);
  });

  it('pool-master-6jk treats a null season as no roster at all, without querying it', async () => {
    const deps = buildDeps({
      prisma: {
        sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: null }) },
        sportEventParticipant: { findMany: jest.fn().mockResolvedValue([buildFieldRow()]) },
        season: { findUnique: jest.fn() },
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.listField('event-1');

    expect(deps.prisma.season.findUnique).not.toHaveBeenCalled();
    expect(result[0].isLeagueRosterMember).toBe(false);
  });
});

describe('GolfFieldService.seedFieldFromLeagueRoster', () => {
  it('pool-master-6jk rejects with 409 TOURNAMENT_HAS_NO_SEASON when the event has no season', async () => {
    const deps = buildDeps({
      prisma: { sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: null }) } },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await expect(service.seedFieldFromLeagueRoster('event-1')).rejects.toMatchObject({
      name: 'GolfFieldError',
      code: 'TOURNAMENT_HAS_NO_SEASON',
      statusCode: 409,
    });
  });

  it('pool-master-6jk filters the roster to ACTIVE participants, skips existing field members, and derives seed/odds only for the added ones', async () => {
    const deps = buildDeps({
      sportLeagueService: {
        getRoster: jest.fn().mockResolvedValue([
          { participantId: 'p-existing', name: 'Existing Golfer', shortName: null, nationality: null, status: 'ACTIVE', worldRanking: 1 },
          { participantId: 'p-new', name: 'New Golfer', shortName: null, nationality: null, status: 'ACTIVE', worldRanking: 2 },
          { participantId: 'p-inactive', name: 'Inactive Golfer', shortName: null, nationality: null, status: 'INACTIVE', worldRanking: 3 },
        ]),
      },
      prisma: {
        sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: 'season-1' }) },
        season: { findUnique: jest.fn().mockResolvedValue({ sportLeagueId: 'league-1' }) },
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([{ participantId: 'p-existing' }]),
          create: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.seedFieldFromLeagueRoster('event-1');

    expect(deps.prisma.sportEventParticipant.create).toHaveBeenCalledTimes(1);
    expect(deps.prisma.sportEventParticipant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sportEventId: 'event-1', participantId: 'p-new', seedNumber: 1 }),
    });
    expect(result).toEqual({
      added: 1,
      skipped: 1,
      total: 2,
      seedNumbersDerived: 1,
      oddsDerived: 1,
    });
  });

  it('pool-master-6jk is a full no-op (no create call) when every active roster member is already in the field', async () => {
    const deps = buildDeps({
      prisma: {
        sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: 'season-1' }) },
        season: { findUnique: jest.fn().mockResolvedValue({ sportLeagueId: 'league-1' }) },
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([{ participantId: 'p-1' }]),
          create: jest.fn(),
        },
        $transaction: jest.fn(),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.seedFieldFromLeagueRoster('event-1');

    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ added: 0, skipped: 1, total: 1 });
  });
});

describe('GolfFieldService.bulkAddFieldEntries', () => {
  it('pool-master-6jk adds participants with no derivation and skips ones already in the field', async () => {
    const deps = buildDeps({
      prisma: {
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([{ participantId: 'p-existing' }]),
          create: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    const result = await service.bulkAddFieldEntries('event-1', ['p-existing', 'p-new']);

    expect(deps.prisma.sportEventParticipant.create).toHaveBeenCalledTimes(1);
    expect(deps.prisma.sportEventParticipant.create).toHaveBeenCalledWith({
      data: { sportEventId: 'event-1', participantId: 'p-new' },
    });
    expect(result).toEqual({ added: 1, skipped: 1, total: 2 });
  });
});

describe('GolfFieldService.bulkUpdateFieldEntries', () => {
  it('pool-master-6jk writes field columns and upserts the golf valuation price with priceAssignedSource=MANUAL', async () => {
    const deps = buildDeps({
      prisma: {
        sportEvent: { findUniqueOrThrow: jest.fn().mockResolvedValue({ seasonId: null }) },
        sportEventParticipant: {
          findMany: jest.fn()
            .mockResolvedValueOnce([{ id: 'sep-1' }])
            .mockResolvedValueOnce([buildFieldRow()]),
          update: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await service.bulkUpdateFieldEntries('event-1', [
      { sportEventParticipantId: 'sep-1', isActive: false, inactiveReason: 'WITHDRAWN', price: 19.5 },
    ]);

    expect(deps.prisma.sportEventParticipant.update).toHaveBeenCalledWith({
      where: { id: 'sep-1' },
      data: {
        isActive: false,
        inactiveReason: 'WITHDRAWN',
        golfValuation: {
          upsert: {
            create: { price: 19.5, priceAssignedSource: 'MANUAL' },
            update: { price: 19.5, priceAssignedSource: 'MANUAL' },
          },
        },
      },
    });
  });

  it('pool-master-6jk rejects with 404 FIELD_ENTRY_NOT_FOUND for an entry not on this event, before writing anything', async () => {
    const deps = buildDeps({
      prisma: {
        sportEventParticipant: {
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
        },
        $transaction: jest.fn(),
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await expect(
      service.bulkUpdateFieldEntries('event-1', [{ sportEventParticipantId: 'sep-missing', isActive: true }]),
    ).rejects.toMatchObject({ name: 'GolfFieldError', code: 'FIELD_ENTRY_NOT_FOUND', statusCode: 404 });
    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('GolfFieldService.removeFieldEntry', () => {
  it('pool-master-6jk deletes a field entry with no picks referencing it', async () => {
    const deps = buildDeps();
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await service.removeFieldEntry('event-1', 'sep-1');

    expect(deps.prisma.sportEventParticipant.delete).toHaveBeenCalledWith({ where: { id: 'sep-1' } });
  });

  it('pool-master-6jk rejects with 409 FIELD_ENTRY_HAS_PICKS when a ContestEntryPick references it', async () => {
    const deps = buildDeps({
      prisma: {
        sportEventParticipant: {
          findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', sportEventId: 'event-1' }),
          delete: jest.fn(),
        },
        contestEntryPick: { count: jest.fn().mockResolvedValue(2) },
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await expect(service.removeFieldEntry('event-1', 'sep-1')).rejects.toMatchObject({
      code: 'FIELD_ENTRY_HAS_PICKS',
      statusCode: 409,
    });
    expect(deps.prisma.sportEventParticipant.delete).not.toHaveBeenCalled();
  });

  it('pool-master-6jk rejects with 404 when the entry belongs to a different sport event', async () => {
    const deps = buildDeps({
      prisma: {
        sportEventParticipant: {
          findUnique: jest.fn().mockResolvedValue({ id: 'sep-1', sportEventId: 'other-event' }),
          delete: jest.fn(),
        },
        contestEntryPick: { count: jest.fn() },
      },
    });
    const service = new GolfFieldService(deps.prisma as any, deps.sportLeagueService as any, deps.random);

    await expect(service.removeFieldEntry('event-1', 'sep-1')).rejects.toMatchObject({
      code: 'FIELD_ENTRY_NOT_FOUND',
      statusCode: 404,
    });
  });
});
