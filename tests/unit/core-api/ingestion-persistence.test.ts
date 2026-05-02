import { Sport } from '@poolmaster/shared/domain';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type { SportEvent } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';

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
  it('pool-master-9ya activates open contests and sends contest-started summary emails when an event starts', async () => {
    const prisma = {
      contestTimingPolicy: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sportEvent: {
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
