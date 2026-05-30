import { Sport } from '@poolmaster/shared/domain';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type {
  ProviderRanking,
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
}

function buildInProgressEvent(): SportEvent {
  return {
    externalId: 'provider-event-1',
    providerId: 'mock-contest-feed',
    sport: Sport.GOLF,
    name: 'Manual Test Golf Tournament',
    startDate: new Date('2026-05-02T20:00:00.000Z'),
    status: 'IN_PROGRESS',
    fieldLocked: true,
    metadata: {
      releaseAt: '2026-05-01T20:00:00.000Z',
      fieldLocksAt: '2026-05-02T19:00:00.000Z',
    },
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

describe('IngestionPersistence', () => {
  it('pool-master-rop.68.1.4 reports created and updated sport event write diagnostics', async () => {
    const existingStartDate = new Date('2026-06-04T12:00:00.000Z');
    const existingReleaseAt = new Date('2026-05-21T12:00:00.000Z');
    const existingFieldLocksAt = new Date('2026-06-03T16:00:00.000Z');
    const prisma = {
      contestTimingPolicy: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sportEvent: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            externalId: 'golf-weekend-1',
            providerId: 'mock-contest-feed',
            sport: Sport.GOLF,
            name: 'Old Weekend 1 Name',
            venue: 'Old Links',
            location: null,
            startDate: existingStartDate,
            endDate: new Date('2026-06-07T22:00:00.000Z'),
            status: 'SCHEDULED',
            rounds: 4,
            participantCount: 72,
            releaseAt: existingReleaseAt,
            fieldLocksAt: existingFieldLocksAt,
            fieldLocked: false,
            metadata: {
              releaseAt: existingReleaseAt.toISOString(),
              fieldLocksAt: existingFieldLocksAt.toISOString(),
              eventType: 'stroke_play',
            },
          })
          .mockResolvedValueOnce(null),
        upsert: jest.fn()
          .mockResolvedValueOnce({ id: 'sport-event-1' })
          .mockResolvedValueOnce({ id: 'sport-event-2' }),
      },
    };
    const persistence = new IngestionPersistence(prisma as any, createLogger() as any);
    const events: SportEvent[] = [
      {
        externalId: 'golf-weekend-1',
        providerId: 'mock-contest-feed',
        sport: Sport.GOLF,
        name: 'Rolling QA Weekend 1 Championship',
        venue: 'PoolMaster QA Links',
        startDate: existingStartDate,
        endDate: new Date('2026-06-07T22:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 80,
        fieldLocked: false,
        metadata: {
          releaseAt: existingReleaseAt.toISOString(),
          fieldLocksAt: existingFieldLocksAt.toISOString(),
          eventType: 'stroke_play',
        },
      },
      {
        externalId: 'golf-weekend-2',
        providerId: 'mock-contest-feed',
        sport: Sport.GOLF,
        name: 'Rolling QA Weekend 2 Championship',
        venue: 'PoolMaster QA Links',
        startDate: new Date('2026-06-11T12:00:00.000Z'),
        endDate: new Date('2026-06-14T22:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 80,
        fieldLocked: false,
        metadata: {
          releaseAt: '2026-05-28T12:00:00.000Z',
          fieldLocksAt: '2026-06-10T16:00:00.000Z',
          eventType: 'stroke_play',
        },
      },
    ];

    const result = await persistence.persistEventsWithDiagnostics(events);

    expect(result).toMatchObject({
      count: 2,
      value: 2,
      writeDiagnostics: {
        summary: {
          total: 2,
          unchanged: 0,
          created: 1,
          updated: 1,
          deleted: 0,
        },
        rows: [
          expect.objectContaining({
            entityType: 'SportEvent',
            disposition: 'UPDATED',
            internalId: 'sport-event-1',
            before: expect.objectContaining({
              name: 'Old Weekend 1 Name',
              participantCount: 72,
            }),
            after: expect.objectContaining({
              name: 'Rolling QA Weekend 1 Championship',
              participantCount: 80,
            }),
          }),
          expect.objectContaining({
            entityType: 'SportEvent',
            disposition: 'CREATED',
            internalId: 'sport-event-2',
            after: expect.objectContaining({
              externalId: 'golf-weekend-2',
              participantCount: 80,
            }),
          }),
        ],
      },
    });
  });

  it('pool-master-rop.68.1.3 persists provider-scoped participant ranking snapshots by provider mapping', async () => {
    const prisma = {
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'ranking-snapshot-1' }),
      },
    };
    const persistence = new IngestionPersistence(prisma as any, createLogger() as any);
    const ranking: ProviderRanking = {
      providerId: 'mock-contest-feed',
      participantExternalId: 'golfer-01',
      rankingType: 'OWGR',
      rank: 3,
      points: 12.34,
      asOfDate: new Date('2026-05-29T12:00:00.000Z'),
    };

    await expect(persistence.persistRankings([ranking])).resolves.toBe(1);

    expect(prisma.participantProviderMapping.findUnique).toHaveBeenCalledWith({
      where: {
        providerId_externalId: {
          providerId: 'mock-contest-feed',
          externalId: 'golfer-01',
        },
      },
    });
    expect(prisma.participantRankingSnapshot.upsert).toHaveBeenCalledWith({
      where: {
        providerId_participantId_rankingType_asOfDate: {
          providerId: 'mock-contest-feed',
          participantId: 'participant-1',
          rankingType: 'OWGR',
          asOfDate: new Date('2026-05-29T12:00:00.000Z'),
        },
      },
      create: {
        providerId: 'mock-contest-feed',
        participantId: 'participant-1',
        rankingType: 'OWGR',
        rank: 3,
        points: 12.34,
        asOfDate: new Date('2026-05-29T12:00:00.000Z'),
      },
      update: {
        rank: 3,
        points: 12.34,
      },
    });
  });

  it('pool-master-rop.68.1.4 reports created and updated ranking snapshot write diagnostics', async () => {
    const asOfDate = new Date('2026-05-29T12:00:00.000Z');
    const prisma = {
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'ranking-snapshot-existing',
            providerId: 'mock-contest-feed',
            participantId: 'participant-1',
            rankingType: 'OWGR',
            rank: 4,
            points: 10.12,
            asOfDate,
          })
          .mockResolvedValueOnce(null),
        upsert: jest.fn().mockResolvedValue({ id: 'ranking-snapshot-1' }),
      },
    };
    const persistence = new IngestionPersistence(prisma as any, createLogger() as any);
    const rankings: ProviderRanking[] = [
      {
        providerId: 'mock-contest-feed',
        participantExternalId: 'golfer-01',
        rankingType: 'OWGR',
        rank: 3,
        points: 12.34,
        asOfDate,
      },
      {
        providerId: 'mock-contest-feed',
        participantExternalId: 'golfer-02',
        rankingType: 'OWGR',
        rank: 8,
        points: 5.67,
        asOfDate,
      },
    ];

    await expect(persistence.persistRankingsWithDiagnostics(rankings)).resolves.toMatchObject({
      count: 2,
      value: 2,
      writeDiagnostics: {
        summary: {
          total: 2,
          unchanged: 0,
          created: 1,
          updated: 1,
          deleted: 0,
        },
        rows: [
          expect.objectContaining({
            entityType: 'ParticipantRankingSnapshot',
            disposition: 'UPDATED',
            before: expect.objectContaining({ rank: 4, points: 10.12 }),
            after: expect.objectContaining({ rank: 3, points: 12.34 }),
          }),
          expect.objectContaining({
            entityType: 'ParticipantRankingSnapshot',
            disposition: 'CREATED',
            after: expect.objectContaining({ rank: 8, points: 5.67 }),
          }),
        ],
      },
    });
  });

  it('pool-master-rop.68.1.4 reports unchanged ranking snapshots for idempotent ranking reruns', async () => {
    const asOfDate = new Date('2026-05-29T12:00:00.000Z');
    const prisma = {
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ranking-snapshot-existing',
          providerId: 'mock-contest-feed',
          participantId: 'participant-1',
          rankingType: 'OWGR',
          rank: 3,
          points: 12.34,
          asOfDate,
        }),
        upsert: jest.fn().mockResolvedValue({ id: 'ranking-snapshot-existing' }),
      },
    };
    const persistence = new IngestionPersistence(prisma as any, createLogger() as any);

    const result = await persistence.persistRankingsWithDiagnostics([
      {
        providerId: 'mock-contest-feed',
        participantExternalId: 'golfer-01',
        rankingType: 'OWGR',
        rank: 3,
        points: 12.34,
        asOfDate,
      },
    ]);

    expect(result.writeDiagnostics.summary).toEqual({
      total: 1,
      unchanged: 1,
      created: 0,
      updated: 0,
      deleted: 0,
    });
    expect(result.writeDiagnostics.rows).toEqual([
      expect.objectContaining({
        entityType: 'ParticipantRankingSnapshot',
        disposition: 'UNCHANGED',
        before: expect.objectContaining({ rank: 3, points: 12.34 }),
        after: expect.objectContaining({ rank: 3, points: 12.34 }),
      }),
    ]);
  });

  it('pool-master-rop.68.1.3 hydrates event participants with seed, event-scoped odds, and latest global rank', async () => {
    const prisma = {
      contestTimingPolicy: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sportEvent: {
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participant: {
        update: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ rank: 7 }),
      },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      },
    };
    const persistence = new IngestionPersistence(prisma as any, createLogger() as any);
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          name: 'Scottie Scheffler',
          active: true,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'golf-open-2026',
          },
        },
      ],
    };

    await expect(persistence.persistEventDetail(detail)).resolves.toEqual({
      eventsPersisted: 1,
      participantsPersisted: 1,
      sportEventParticipantsPersisted: 1,
    });

    expect(prisma.participantRankingSnapshot.findFirst).toHaveBeenCalledWith({
      where: {
        providerId: 'mock-contest-feed',
        participantId: 'participant-1',
        rankingType: 'OWGR',
      },
      orderBy: { asOfDate: 'desc' },
    });
    expect(prisma.sportEventParticipant.upsert).toHaveBeenCalledWith({
      where: {
        sportEventId_participantId: {
          sportEventId: 'sport-event-1',
          participantId: 'participant-1',
        },
      },
      create: {
        sportEventId: 'sport-event-1',
        participantId: 'participant-1',
        status: 'ACTIVE',
        worldRanking: 7,
        oddsToWin: 8.5,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
      update: {
        status: 'ACTIVE',
        worldRanking: 7,
        oddsToWin: 8.5,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
    });
  });

  it('pool-master-rop.68.1.4 reports before and after JSON for updated event participants', async () => {
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          name: 'Scottie Scheffler',
          active: true,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'golf-open-2026',
          },
        },
      ],
    };
    const prisma = {
      contestTimingPolicy: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sportEvent: {
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'sport-event-1',
            externalId: 'golf-open-2026',
            providerId: 'mock-contest-feed',
            sport: Sport.GOLF,
            name: 'Manual Test Golf Tournament',
            venue: null,
            location: null,
            startDate: detail.startDate,
            endDate: null,
            status: 'SCHEDULED',
            rounds: null,
            participantCount: null,
            releaseAt: new Date('2026-05-01T20:00:00.000Z'),
            fieldLocksAt: new Date('2026-05-02T19:00:00.000Z'),
            fieldLocked: true,
            metadata: detail.metadata,
          })
          .mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participant: {
        update: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ rank: 7 }),
      },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sport-event-participant-1',
          status: 'ACTIVE',
          worldRanking: 12,
          oddsToWin: 11.25,
          seedNumber: 3,
          metadata: {
            seed: 3,
            odds: 11.25,
            oddsSourceEventId: 'golf-open-2026',
          },
        }),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      },
    };
    const persistence = new IngestionPersistence(prisma as any, createLogger() as any);

    const result = await persistence.persistEventDetailWithDiagnostics(detail);

    expect(result.writeDiagnostics.summary).toEqual({
      total: 1,
      unchanged: 0,
      created: 0,
      updated: 1,
      deleted: 0,
    });
    expect(result.writeDiagnostics.rows).toEqual([
      expect.objectContaining({
        entityType: 'SportEventParticipant',
        disposition: 'UPDATED',
        name: 'Scottie Scheffler',
        before: expect.objectContaining({
          worldRanking: 12,
          oddsToWin: 11.25,
          seedNumber: 3,
        }),
        after: expect.objectContaining({
          worldRanking: 7,
          oddsToWin: 8.5,
          seedNumber: 1,
        }),
      }),
    ]);
  });

  it('pool-master-rop.68.1.3 does not bleed mismatched event odds or absent global ranking onto event participants', async () => {
    const prisma = {
      contestTimingPolicy: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sportEvent: {
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participant: {
        update: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      participantRankingSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      },
    };
    const persistence = new IngestionPersistence(prisma as any, createLogger() as any);
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          name: 'Scottie Scheffler',
          active: true,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'different-provider-event',
          },
        },
      ],
    };

    await expect(persistence.persistEventDetail(detail)).resolves.toEqual({
      eventsPersisted: 1,
      participantsPersisted: 1,
      sportEventParticipantsPersisted: 1,
    });

    expect(prisma.sportEventParticipant.upsert).toHaveBeenCalledWith({
      where: {
        sportEventId_participantId: {
          sportEventId: 'sport-event-1',
          participantId: 'participant-1',
        },
      },
      create: {
        sportEventId: 'sport-event-1',
        participantId: 'participant-1',
        status: 'ACTIVE',
        worldRanking: null,
        oddsToWin: null,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
      update: {
        status: 'ACTIVE',
        worldRanking: null,
        oddsToWin: null,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
    });
  });

  it('pool-master-9ya activates open contests and sends contest-started summary emails when an event starts', async () => {
    const prisma = {
      contestTimingPolicy: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
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
    const persistence = new IngestionPersistence(
      prisma as any,
      createLogger() as any,
      mailDelivery,
      'https://app.primetimecommissioner.com',
    );

    await expect(persistence.persistEvents([buildInProgressEvent()])).resolves.toBe(1);

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
      contestTimingPolicy: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
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
    const persistence = new IngestionPersistence(
      prisma as any,
      createLogger() as any,
      mailDelivery,
    );

    await persistence.persistEvents([buildInProgressEvent()]);

    expect(mailDelivery.send).not.toHaveBeenCalled();
  });

  it('pool-master-9ya keeps ingestion successful when contest-started email delivery fails', async () => {
    const logger = createLogger();
    const prisma = {
      contestTimingPolicy: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
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
    const persistence = new IngestionPersistence(
      prisma as any,
      logger as any,
      mailDelivery,
    );

    await expect(persistence.persistEvents([buildInProgressEvent()])).resolves.toBe(1);

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
