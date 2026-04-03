import { SupportService } from '../../../packages/core-api/src/modules/admin/support-service';

function createMockPrisma(overrides: Record<string, any> = {}) {
  return {
    tenant: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    league: { findMany: jest.fn() },
    contest: { findMany: jest.fn() },
    notificationDeliveryLog: { findMany: jest.fn() },
    contestStanding: { findFirst: jest.fn() },
    contestResult: { findFirst: jest.fn() },
    adminAuditEntry: { findMany: jest.fn(), count: jest.fn() },
    ...overrides,
  } as any;
}

describe('SupportService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('derives investigation data from persisted notification logs, audit entries, and scoring state', async () => {
    const now = new Date('2026-04-03T12:00:00Z');
    jest.useFakeTimers().setSystemTime(now);

    const prisma = createMockPrisma({
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1' }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-1' }]) },
      league: { findMany: jest.fn().mockResolvedValue([{ id: 'league-1' }]) },
      contest: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'contest-1', name: 'Masters 2026 Pool', sport: 'GOLF', updatedAt: new Date('2026-04-03T11:20:00Z') },
        ]),
      },
      notificationDeliveryLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'delivery-1',
            notificationEventId: 'contest.lock_approaching',
            channel: 'PUSH',
            failedReason: 'Device token expired',
            suppressionReason: null,
            userId: 'user-1',
            createdAt: new Date('2026-04-03T11:50:00Z'),
            status: 'FAILED',
          },
        ]),
      },
      contestStanding: {
        findFirst: jest.fn().mockResolvedValue({ lastUpdatedAt: new Date('2026-04-03T11:00:00Z') }),
      },
      contestResult: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      adminAuditEntry: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'audit-1',
            action: 'contest.override_score',
            resourceType: 'CONTEST',
            resourceId: 'contest-1',
            description: 'Adjusted score after review',
            adminUserEmail: 'admin@poolmaster.io',
            createdAt: new Date('2026-04-03T11:40:00Z'),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    });

    const service = new SupportService(prisma);
    const investigation = await service.getInvestigation('tenant-1');

    expect(investigation.tenantId).toBe('tenant-1');
    expect(investigation.notificationFailures).toHaveLength(1);
    expect(investigation.notificationFailures[0]).toMatchObject({
      eventType: 'contest.lock_approaching',
      failureReason: 'Device token expired',
    });
    expect(investigation.recentActivity).toHaveLength(1);
    expect(investigation.recentActivity[0]).toMatchObject({
      action: 'contest.override_score',
      resourceId: 'contest-1',
    });
    expect(investigation.scoringStaleness).toHaveLength(1);
    expect(investigation.scoringStaleness[0].staleMinutes).toBeGreaterThan(30);
    expect(investigation.recentErrors.some((error) => error.errorType === 'STALE_SCORING')).toBe(true);
    expect(investigation.pendingCorrections).toBe(1);
    expect(investigation.failedWebhooks).toBe(1);
  });

  it('returns notification failures directly from persisted delivery logs', async () => {
    const prisma = createMockPrisma({
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1' }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]) },
      league: { findMany: jest.fn().mockResolvedValue([]) },
      contest: { findMany: jest.fn().mockResolvedValue([]) },
      notificationDeliveryLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'delivery-1',
            notificationEventId: 'draft.on_the_clock',
            channel: 'EMAIL',
            failedReason: 'Mailbox full',
            suppressionReason: null,
            userId: 'user-1',
            createdAt: new Date('2026-04-03T09:00:00Z'),
            status: 'FAILED',
          },
        ]),
      },
      contestStanding: { findFirst: jest.fn().mockResolvedValue(null) },
      contestResult: { findFirst: jest.fn().mockResolvedValue(null) },
      adminAuditEntry: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    });

    const service = new SupportService(prisma);
    const failures = await service.getNotificationFailures('tenant-1');

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      eventType: 'draft.on_the_clock',
      channel: 'EMAIL',
      failureReason: 'Mailbox full',
      userId: 'user-1',
    });
  });
});
