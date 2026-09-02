import {
  GolfRoundScheduleService,
} from '../../../packages/core-api/src/modules/golf/golf-round-schedule-service';

function buildRoundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `round-${overrides.roundNumber ?? 1}`,
    sportEventId: 'event-1',
    roundNumber: 1,
    scheduledDate: new Date('2026-06-01T00:00:00.000Z'),
    scheduledEndAt: null,
    ...overrides,
  };
}

describe('GolfRoundScheduleService.ensureSportEventRounds', () => {
  it('pool-master-k6q creates one round per `rounds` on sequential daily dates from startDate when none exist', async () => {
    const create = jest.fn()
      .mockImplementation(({ data }) => Promise.resolve(buildRoundRow({ roundNumber: data.roundNumber, scheduledDate: data.scheduledDate })));
    const findMany = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        buildRoundRow({ roundNumber: 1, scheduledDate: new Date('2026-06-01T00:00:00.000Z') }),
        buildRoundRow({ roundNumber: 2, scheduledDate: new Date('2026-06-02T00:00:00.000Z') }),
        buildRoundRow({ roundNumber: 3, scheduledDate: new Date('2026-06-03T00:00:00.000Z') }),
        buildRoundRow({ roundNumber: 4, scheduledDate: new Date('2026-06-04T00:00:00.000Z') }),
      ]);
    const prisma = {
      sportEventRound: { findMany, create },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfRoundScheduleService(prisma as any);

    const result = await service.ensureSportEventRounds({
      sportEventId: 'event-1',
      rounds: 4,
      startDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(create).toHaveBeenCalledTimes(4);
    expect(create).toHaveBeenCalledWith({
      data: {
        sportEventId: 'event-1',
        roundNumber: 3,
        scheduledDate: new Date('2026-06-03T00:00:00.000Z'),
      },
    });
    expect(result.map((round) => round.roundNumber)).toEqual([1, 2, 3, 4]);
  });

  it('pool-master-k6q is idempotent — only creates rounds that don\'t already have a row', async () => {
    const create = jest.fn()
      .mockImplementation(({ data }) => Promise.resolve(buildRoundRow({ roundNumber: data.roundNumber, scheduledDate: data.scheduledDate })));
    const findMany = jest.fn()
      .mockResolvedValueOnce([buildRoundRow({ roundNumber: 1 }), buildRoundRow({ roundNumber: 2 })])
      .mockResolvedValueOnce([
        buildRoundRow({ roundNumber: 1 }),
        buildRoundRow({ roundNumber: 2 }),
        buildRoundRow({ roundNumber: 3 }),
      ]);
    const prisma = {
      sportEventRound: { findMany, create },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfRoundScheduleService(prisma as any);

    const result = await service.ensureSportEventRounds({
      sportEventId: 'event-1',
      rounds: 3,
      startDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        sportEventId: 'event-1',
        roundNumber: 3,
        scheduledDate: new Date('2026-06-03T00:00:00.000Z'),
      },
    });
    expect(result).toHaveLength(3);
  });

  it('pool-master-k6q is a full no-op when every round number already exists', async () => {
    const create = jest.fn();
    const existing = [buildRoundRow({ roundNumber: 1 }), buildRoundRow({ roundNumber: 2 })];
    const findMany = jest.fn().mockResolvedValue(existing);
    const prisma = {
      sportEventRound: { findMany, create },
      $transaction: jest.fn(),
    };
    const service = new GolfRoundScheduleService(prisma as any);

    await service.ensureSportEventRounds({
      sportEventId: 'event-1',
      rounds: 2,
      startDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('GolfRoundScheduleService.listSportEventRounds', () => {
  it('pool-master-k6q returns rounds ordered by roundNumber ascending', async () => {
    const findMany = jest.fn().mockResolvedValue([buildRoundRow({ roundNumber: 1 })]);
    const prisma = { sportEventRound: { findMany } };
    const service = new GolfRoundScheduleService(prisma as any);

    await service.listSportEventRounds('event-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { sportEventId: 'event-1' },
      orderBy: { roundNumber: 'asc' },
    });
  });
});

describe('GolfRoundScheduleService.updateSportEventRounds', () => {
  it('pool-master-k6q reschedules an existing round\'s date and end', async () => {
    const existing = [buildRoundRow({ roundNumber: 1 }), buildRoundRow({ roundNumber: 2 })];
    const findMany = jest.fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce([
        buildRoundRow({ roundNumber: 1 }),
        buildRoundRow({ roundNumber: 2, scheduledDate: new Date('2026-06-05T00:00:00.000Z'), scheduledEndAt: new Date('2026-06-05T20:00:00.000Z') }),
      ]);
    const update = jest.fn().mockResolvedValue(buildRoundRow({ roundNumber: 2 }));
    const prisma = {
      sportEventRound: { findMany, update },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfRoundScheduleService(prisma as any);

    const result = await service.updateSportEventRounds('event-1', [
      { roundNumber: 2, scheduledDate: new Date('2026-06-05T00:00:00.000Z'), scheduledEndAt: new Date('2026-06-05T20:00:00.000Z') },
    ]);

    expect(update).toHaveBeenCalledWith({
      where: { sportEventId_roundNumber: { sportEventId: 'event-1', roundNumber: 2 } },
      data: {
        scheduledDate: new Date('2026-06-05T00:00:00.000Z'),
        scheduledEndAt: new Date('2026-06-05T20:00:00.000Z'),
      },
    });
    expect(result[1].scheduledEndAt).toEqual(new Date('2026-06-05T20:00:00.000Z'));
  });

  it('pool-master-k6q throws GolfRoundScheduleError for a roundNumber this event has no row for, and never creates one', async () => {
    const findMany = jest.fn().mockResolvedValue([buildRoundRow({ roundNumber: 1 })]);
    const update = jest.fn();
    const prisma = {
      sportEventRound: { findMany, update },
      $transaction: jest.fn(),
    };
    const service = new GolfRoundScheduleService(prisma as any);

    await expect(
      service.updateSportEventRounds('event-1', [
        { roundNumber: 7, scheduledDate: new Date('2026-06-05T00:00:00.000Z') },
      ]),
    ).rejects.toMatchObject({
      name: 'GolfRoundScheduleError',
      code: 'ROUND_NOT_FOUND',
      statusCode: 404,
    });
    expect(update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('pool-master-k6q clears scheduledEndAt when explicitly passed null, but leaves it untouched when omitted', async () => {
    const existing = [buildRoundRow({ roundNumber: 1, scheduledEndAt: new Date('2026-06-01T20:00:00.000Z') })];
    const findMany = jest.fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);
    const update = jest.fn().mockResolvedValue(buildRoundRow({ roundNumber: 1 }));
    const prisma = {
      sportEventRound: { findMany, update },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfRoundScheduleService(prisma as any);

    await service.updateSportEventRounds('event-1', [
      { roundNumber: 1, scheduledDate: new Date('2026-06-01T00:00:00.000Z'), scheduledEndAt: null },
    ]);

    expect(update).toHaveBeenCalledWith({
      where: { sportEventId_roundNumber: { sportEventId: 'event-1', roundNumber: 1 } },
      data: {
        scheduledDate: new Date('2026-06-01T00:00:00.000Z'),
        scheduledEndAt: null,
      },
    });
  });
});

describe('GolfRoundScheduleService.createSportEventRoundsFromSchedule', () => {
  it('pool-master-5h3 creates one row per entry in an already-derived schedule verbatim', async () => {
    const create = jest.fn().mockResolvedValue({});
    const findMany = jest.fn().mockResolvedValue([
      buildRoundRow({ roundNumber: 1, scheduledDate: new Date('2027-04-08T00:00:00.000Z') }),
      buildRoundRow({ roundNumber: 4, scheduledDate: new Date('2027-04-12T00:00:00.000Z') }),
    ]);
    const prisma = {
      sportEventRound: { findMany, create },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    const service = new GolfRoundScheduleService(prisma as any);

    const result = await service.createSportEventRoundsFromSchedule('event-1', [
      { roundNumber: 1, scheduledDate: new Date('2027-04-08T00:00:00.000Z') },
      { roundNumber: 4, scheduledDate: new Date('2027-04-12T00:00:00.000Z'), scheduledEndAt: new Date('2027-04-12T20:00:00.000Z') },
    ]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith({
      data: {
        sportEventId: 'event-1',
        roundNumber: 1,
        scheduledDate: new Date('2027-04-08T00:00:00.000Z'),
        scheduledEndAt: null,
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        sportEventId: 'event-1',
        roundNumber: 4,
        scheduledDate: new Date('2027-04-12T00:00:00.000Z'),
        scheduledEndAt: new Date('2027-04-12T20:00:00.000Z'),
      },
    });
    expect(result.map((round) => round.roundNumber)).toEqual([1, 4]);
  });
});
