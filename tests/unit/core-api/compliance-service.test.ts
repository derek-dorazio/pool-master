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

describe('ComplianceService account deletion and export access control', () => {
  it('rejects cancelling another user\'s deletion request', async () => {
    const prisma = {
      deletionRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'deletion-1',
          userId: 'user-1',
        }),
        update: jest.fn(),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.cancelDeletion('deletion-1', 'user-2')).rejects.toThrow(
      'another user\'s deletion request',
    );
    expect(prisma.deletionRequest.update).not.toHaveBeenCalled();
  });

  it('rejects processing another user\'s export request', async () => {
    const prisma = {
      dataExportRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'export-1',
          userId: 'user-1',
          status: 'PENDING',
          requestedAt: new Date('2026-04-01T12:00:00.000Z'),
        }),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.processDataExport('export-1', 'user-2')).rejects.toThrow(
      'another user\'s data export request',
    );
  });
});

describe('ComplianceService self-exclusion status', () => {
  it('ignores expired cool-down exclusions when reading the active exclusion', async () => {
    const prisma = {
      selfExclusion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cooldown-1',
            userId: 'user-1',
            exclusionType: 'COOL_DOWN',
            duration: '24H',
            endsAt: new Date('2026-03-01T12:00:00.000Z'),
            isActive: true,
            startedAt: new Date('2026-02-28T12:00:00.000Z'),
          },
        ]),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.getActiveExclusion('user-1')).resolves.toBeNull();
  });

  it('returns an active self-exclusion even when the duration is open-ended', async () => {
    const prisma = {
      selfExclusion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'exclusion-1',
            userId: 'user-1',
            exclusionType: 'SELF_EXCLUSION',
            duration: 'INDEFINITE',
            endsAt: null,
            isActive: true,
            startedAt: new Date('2026-04-01T12:00:00.000Z'),
          },
        ]),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.getActiveExclusion('user-1')).resolves.toEqual({
      id: 'exclusion-1',
      userId: 'user-1',
      exclusionType: 'SELF_EXCLUSION',
      duration: 'INDEFINITE',
      endsAt: null,
      isActive: true,
      startedAt: new Date('2026-04-01T12:00:00.000Z'),
    });
  });
});

describe('ComplianceService session reminders', () => {
  it('returns the default session reminder when no preference exists', async () => {
    const prisma = {
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.getSessionReminder('user-1')).resolves.toEqual({
      enabled: false,
      intervalMinutes: 60,
    });
  });

  it('persists session reminder updates into notification preferences', async () => {
    const prisma = {
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue({
          categoryPreferences: {
            activityLimit: { enabled: true, weeklyContestLimit: 9 },
          },
        }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any;

    const service = new ComplianceService(prisma);

    await expect(service.updateSessionReminder('user-1', true, 45)).resolves.toEqual({
      enabled: true,
      intervalMinutes: 45,
    });

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: {
        userId: 'user-1',
        categoryPreferences: {
          activityLimit: { enabled: true, weeklyContestLimit: 9 },
          sessionReminder: { enabled: true, intervalMinutes: 45 },
        },
      },
      update: {
        categoryPreferences: {
          activityLimit: { enabled: true, weeklyContestLimit: 9 },
          sessionReminder: { enabled: true, intervalMinutes: 45 },
        },
      },
    });
  });
});
