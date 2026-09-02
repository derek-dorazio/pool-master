import { SPORT_EVENT_STATUS_TRANSITIONS, SportEventStatus, SYSTEM_USER_ID } from '@poolmaster/shared/domain';
import { logAdminAction } from '../../../packages/core-api/src/modules/admin/admin-audit-service';
import {
  EventLifecycleError,
  EventLifecycleService,
} from '../../../packages/core-api/src/modules/events/event-lifecycle-service';

jest.mock('../../../packages/core-api/src/modules/admin/admin-audit-service', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
}

function buildStartedContestCandidate() {
  return {
    id: 'contest-1',
    leagueId: 'league-1',
    name: 'Masters Pick 6',
    league: {
      name: 'Mathworks',
      leagueCode: 'MATHWORKS',
      memberships: [
        {
          role: 'COMMISSIONER',
          user: {
            id: 'commissioner-1',
            email: 'commissioner@example.com',
            firstName: 'Chris',
            lastName: 'Commissioner',
            username: 'commissioner',
            isActive: true,
          },
        },
      ],
    },
    sportEvent: {
      name: 'Manual Test Golf Tournament',
      startDate: new Date('2026-05-02T20:00:00.000Z'),
    },
    entries: [
      {
        id: 'entry-1',
        name: 'Entry 1',
        squad: {
          name: 'Derek Team',
          memberships: [
            {
              user: {
                id: 'member-1',
                email: 'member@example.com',
                firstName: 'Mia',
                lastName: 'Member',
                username: 'member',
                isActive: true,
              },
            },
          ],
        },
      },
    ],
  };
}

function buildSportEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sport-event-1',
    providerId: 'mock-contest-feed',
    externalId: 'provider-event-1',
    name: 'Manual Test Golf Tournament',
    startDate: new Date('2026-05-02T20:00:00.000Z'),
    endDate: null,
    status: SportEventStatus.SCHEDULED,
    ...overrides,
  };
}

describe('SPORT_EVENT_STATUS_TRANSITIONS exhaustiveness', () => {
  it('pool-master-g1z declares a row for every SportEventStatus value', () => {
    // Compile-time exhaustiveness comes from the `satisfies` clause on the
    // const itself; this is the runtime companion proving no key was silently
    // dropped by an edit that also touched the type.
    expect(Object.keys(SPORT_EVENT_STATUS_TRANSITIONS).sort()).toEqual(
      Object.values(SportEventStatus).sort(),
    );
  });
});

describe('EventLifecycleService.applySportEventStatusTransition', () => {
  it('pool-master-g1z allows a declared transition for a ROOT_ADMIN actor', async () => {
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.IN_PROGRESS })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new EventLifecycleService(prisma as any, createLogger() as any);

    const result = await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'ROOT_ADMIN', userId: 'admin-1', email: 'admin@example.com' },
    });

    expect(result.fromStatus).toBe(SportEventStatus.SCHEDULED);
    expect(result.toStatus).toBe(SportEventStatus.IN_PROGRESS);
    expect(prisma.sportEvent.update).toHaveBeenCalledWith({
      where: { id: 'sport-event-1' },
      data: { status: SportEventStatus.IN_PROGRESS },
    });
  });

  it('pool-master-g1z rejects an undeclared transition for a ROOT_ADMIN actor with 422 SPORT_EVENT_INVALID_TRANSITION', async () => {
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn(),
      },
    };
    const service = new EventLifecycleService(prisma as any, createLogger() as any);

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        // SCHEDULED -> COMPLETED skips IN_PROGRESS entirely; not declared.
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'ROOT_ADMIN', userId: 'admin-1', email: 'admin@example.com' },
      }),
    ).rejects.toMatchObject({
      name: 'EventLifecycleError',
      code: 'SPORT_EVENT_INVALID_TRANSITION',
      statusCode: 422,
    });
    expect(prisma.sportEvent.update).not.toHaveBeenCalled();
  });

  it('pool-master-g1z applies an undeclared transition anyway for a PROVIDER actor, only logging it', async () => {
    const logger = createLogger();
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.COMPLETED, endDate: new Date() })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new EventLifecycleService(prisma as any, logger as any);

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'PROVIDER' },
      }),
    ).resolves.toMatchObject({ toStatus: SportEventStatus.COMPLETED });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: SportEventStatus.SCHEDULED, toStatus: SportEventStatus.COMPLETED }),
      expect.stringContaining('not in the declared transition map'),
    );
  });

  it('pool-master-g1z treats a same-status call as a no-op, never rejecting it', async () => {
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.COMPLETED, endDate: new Date('2026-05-31T22:00:00.000Z') })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.COMPLETED, endDate: new Date('2026-05-31T22:00:00.000Z') })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const golfContestSettlement = { settleCompletedSportEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new EventLifecycleService(
      prisma as any,
      createLogger() as any,
      undefined,
      'http://localhost:5173',
      golfContestSettlement,
    );

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'ROOT_ADMIN', userId: 'admin-1', email: 'admin@example.com' },
      }),
    ).resolves.toMatchObject({ fromStatus: SportEventStatus.COMPLETED, toStatus: SportEventStatus.COMPLETED });
  });

  it('pool-master-g1z sets endDate on completion only when it is not already set', async () => {
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.IN_PROGRESS, endDate: null })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.COMPLETED })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new EventLifecycleService(prisma as any, createLogger() as any);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'PROVIDER' },
    });

    expect(prisma.sportEvent.update).toHaveBeenCalledWith({
      where: { id: 'sport-event-1' },
      data: { status: SportEventStatus.COMPLETED, endDate: expect.any(Date) },
    });
  });

  it('pool-master-g1z leaves an already-set endDate alone on completion', async () => {
    const existingEndDate = new Date('2026-05-31T22:00:00.000Z');
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.IN_PROGRESS, endDate: existingEndDate })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.COMPLETED, endDate: existingEndDate })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new EventLifecycleService(prisma as any, createLogger() as any);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'PROVIDER' },
    });

    expect(prisma.sportEvent.update).toHaveBeenCalledWith({
      where: { id: 'sport-event-1' },
      data: { status: SportEventStatus.COMPLETED },
    });
  });

  it('pool-master-g1z writes an AdminAuditEntry for a ROOT_ADMIN transition', async () => {
    (logAdminAction as jest.Mock).mockClear();
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.IN_PROGRESS })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new EventLifecycleService(prisma as any, createLogger() as any);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'ROOT_ADMIN', userId: 'admin-1', email: 'admin@example.com' },
    });

    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      actorEmail: 'admin@example.com',
      action: 'sport_event.transition',
      resourceType: 'SPORT_EVENT',
      resourceId: 'sport-event-1',
      beforeState: { status: SportEventStatus.SCHEDULED },
      afterState: { status: SportEventStatus.IN_PROGRESS },
    }));
  });

  it('pool-master-g1z does not write an AdminAuditEntry for a PROVIDER transition', async () => {
    (logAdminAction as jest.Mock).mockClear();
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.IN_PROGRESS })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new EventLifecycleService(prisma as any, createLogger() as any);

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'PROVIDER' },
    });

    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it('pool-master-k6q allows a declared transition for a SYSTEM actor and writes an AdminAuditEntry attributed to the seeded system user', async () => {
    (logAdminAction as jest.Mock).mockClear();
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.IN_PROGRESS })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new EventLifecycleService(prisma as any, createLogger() as any);

    const result = await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'SYSTEM', reason: 'SCHEDULED_LIFECYCLE' },
    });

    expect(result.toStatus).toBe(SportEventStatus.IN_PROGRESS);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: SYSTEM_USER_ID,
      actorEmail: 'system@poolmaster.internal',
      action: 'sport_event.transition',
      resourceType: 'SPORT_EVENT',
      resourceId: 'sport-event-1',
      beforeState: { status: SportEventStatus.SCHEDULED },
      afterState: { status: SportEventStatus.IN_PROGRESS },
    }));
  });

  it('pool-master-k6q rejects an undeclared transition for a SYSTEM actor with 422 SPORT_EVENT_INVALID_TRANSITION, same as ROOT_ADMIN', async () => {
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn(),
      },
    };
    const service = new EventLifecycleService(prisma as any, createLogger() as any);

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.COMPLETED,
        actor: { type: 'SYSTEM', reason: 'SCHEDULED_LIFECYCLE' },
      }),
    ).rejects.toMatchObject({
      name: 'EventLifecycleError',
      code: 'SPORT_EVENT_INVALID_TRANSITION',
      statusCode: 422,
    });
    expect(prisma.sportEvent.update).not.toHaveBeenCalled();
  });

  // pool-master-eux.6 — relocated from ingestion-persistence.test.ts (that
  // module now only proves it delegates here, see
  // tests/unit/core-api/ingestion-persistence.test.ts).
  it('pool-master-eux.6 triggers Golf contest settlement from completed schedule events', async () => {
    const settlement = {
      settleCompletedSportEvent: jest.fn().mockResolvedValue({ contestsCompleted: 1 }),
    };
    const eventEndDate = new Date('2026-05-31T22:00:00.000Z');
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          buildSportEventRow({ status: SportEventStatus.IN_PROGRESS, endDate: eventEndDate }),
        ),
        update: jest.fn().mockResolvedValue(
          buildSportEventRow({ status: SportEventStatus.COMPLETED, endDate: eventEndDate }),
        ),
      },
    };
    const service = new EventLifecycleService(
      prisma as any,
      createLogger() as any,
      undefined,
      'http://localhost:5173',
      settlement,
    );

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.COMPLETED,
      actor: { type: 'PROVIDER' },
    });

    expect(settlement.settleCompletedSportEvent).toHaveBeenCalledWith('sport-event-1', {
      completedAt: eventEndDate,
    });
  });

  // pool-master-9ya — relocated from ingestion-persistence.test.ts.
  it('pool-master-9ya activates open contests and sends contest-started summary emails when an event starts', async () => {
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.IN_PROGRESS })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([buildStartedContestCandidate()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const mailDelivery = {
      providerName: 'smtp' as const,
      send: jest.fn().mockResolvedValue({ provider: 'smtp' as const, messageId: 'mail-1' }),
    };
    const service = new EventLifecycleService(
      prisma as any,
      createLogger() as any,
      mailDelivery,
      'https://app.primetimecommissioner.com',
    );

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'PROVIDER' },
    });

    expect(prisma.contest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'contest-1',
        status: { in: ['OPEN', 'LOCKED'] },
      },
      data: {
        status: 'ACTIVE',
        startsAt: new Date('2026-05-02T20:00:00.000Z'),
      },
    });
    expect(mailDelivery.send).toHaveBeenCalledTimes(2);
    expect(mailDelivery.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'commissioner@example.com',
      subject: 'Masters Pick 6 has started',
      metadata: {
        templateKey: 'CONTEST_STARTED_SUMMARY',
        leagueId: 'league-1',
        contestId: 'contest-1',
      },
    }));
    const memberMessage = mailDelivery.send.mock.calls.find(
      ([message]) => message.to === 'member@example.com',
    )?.[0];
    expect(memberMessage?.text).toContain('Manual Test Golf Tournament');
    expect(memberMessage?.text).toContain('Entries: 1');
    expect(memberMessage?.text).toContain('- Entry 1: Derek Team');
    expect(memberMessage?.text).toContain(
      'Open contest board: https://app.primetimecommissioner.com/league/MATHWORKS/contests/contest-1',
    );
    expect(memberMessage?.html).toContain('Prime Time Commissioner');
  });

  it('pool-master-9ya does not resend contest-started email when the contest is already active', async () => {
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.IN_PROGRESS })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([buildStartedContestCandidate()]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const mailDelivery = {
      providerName: 'smtp' as const,
      send: jest.fn(),
    };
    const service = new EventLifecycleService(
      prisma as any,
      createLogger() as any,
      mailDelivery,
    );

    await service.applySportEventStatusTransition({
      sportEventId: 'sport-event-1',
      toStatus: SportEventStatus.IN_PROGRESS,
      actor: { type: 'PROVIDER' },
    });

    expect(mailDelivery.send).not.toHaveBeenCalled();
  });

  it('pool-master-9ya keeps the transition successful when contest-started email delivery fails', async () => {
    const logger = createLogger();
    const prisma = {
      sportEvent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.SCHEDULED })),
        update: jest.fn().mockResolvedValue(buildSportEventRow({ status: SportEventStatus.IN_PROGRESS })),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([buildStartedContestCandidate()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const mailDelivery = {
      providerName: 'ses' as const,
      send: jest.fn().mockRejectedValue(new Error('SES rejected request')),
    };
    const service = new EventLifecycleService(
      prisma as any,
      logger as any,
      mailDelivery,
    );

    await expect(
      service.applySportEventStatusTransition({
        sportEventId: 'sport-event-1',
        toStatus: SportEventStatus.IN_PROGRESS,
        actor: { type: 'PROVIDER' },
      }),
    ).resolves.toMatchObject({ toStatus: SportEventStatus.IN_PROGRESS });

    expect(mailDelivery.send).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        contestId: 'contest-1',
        templateKey: 'CONTEST_STARTED_SUMMARY',
      }),
      'Failed to deliver contest started summary email',
    );
  });
});

describe('EventLifecycleError', () => {
  it('pool-master-g1z defaults to 422 SPORT_EVENT_INVALID_TRANSITION', () => {
    const error = new EventLifecycleError('bad transition');
    expect(error.code).toBe('SPORT_EVENT_INVALID_TRANSITION');
    expect(error.statusCode).toBe(422);
    expect(error.name).toBe('EventLifecycleError');
  });
});
