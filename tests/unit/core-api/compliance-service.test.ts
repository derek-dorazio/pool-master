import { ComplianceService } from '../../../packages/core-api/src/modules/compliance/compliance-service';

describe('ComplianceService data export status', () => {
  it('returns none when no export request exists', async () => {
    const prisma = {
      dataExportRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.getDataExportStatus('user-1')).resolves.toEqual({
      status: 'none',
      requestedAt: null,
      downloadUrl: null,
      expiresAt: null,
      nextAllowedAt: null,
    });

    expect(prisma.dataExportRequest.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { requestedAt: 'desc' },
    });
  });

  it('maps the latest completed export request to ready status', async () => {
    const prisma = {
      dataExportRequest: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'COMPLETED',
          requestedAt: new Date('2026-04-01T12:00:00.000Z'),
          downloadUrl: 'https://example.com/export.csv',
          downloadExpiresAt: new Date('2026-04-02T12:00:00.000Z'),
        }),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.getDataExportStatus('user-1')).resolves.toEqual({
      status: 'ready',
      requestedAt: '2026-04-01T12:00:00.000Z',
      downloadUrl: 'https://example.com/export.csv',
      expiresAt: '2026-04-02T12:00:00.000Z',
      nextAllowedAt: null,
    });
  });

  it('returns the persisted activity limit when present', async () => {
    const prisma = {
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue({
          categoryPreferences: {
            activityLimit: {
              enabled: true,
              weeklyContestLimit: 7,
            },
          },
        }),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.getActivityLimit('user-1')).resolves.toEqual({
      enabled: true,
      weeklyContestLimit: 7,
    });
  });

  it('persists activity limit updates into notification preferences', async () => {
    const prisma = {
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue({
          categoryPreferences: {
            sessionReminder: { enabled: true, intervalMinutes: 60 },
          },
        }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.updateActivityLimit('user-1', true, 12)).resolves.toEqual({
      enabled: true,
      weeklyContestLimit: 12,
    });

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: {
        userId: 'user-1',
        categoryPreferences: {
          sessionReminder: { enabled: true, intervalMinutes: 60 },
          activityLimit: { enabled: true, weeklyContestLimit: 12 },
        },
      },
      update: {
        categoryPreferences: {
          sessionReminder: { enabled: true, intervalMinutes: 60 },
          activityLimit: { enabled: true, weeklyContestLimit: 12 },
        },
      },
    });
  });
});
