import {
  exportAuditLogCsv,
  getAuditEntryById,
  queryAuditLog,
  setAuditQueryLogger,
  setAuditQueryPrisma,
} from '../../../packages/core-api/src/modules/admin/audit-query-service';
import { HealthService } from '../../../packages/core-api/src/modules/admin/health-service';
import { IngestionConfigService } from '../../../packages/core-api/src/modules/admin/ingestion-config-service';
import { PollConfigService } from '../../../packages/core-api/src/modules/admin/poll-config-service';
import { UserNotFoundError, UserService } from '../../../packages/core-api/src/modules/admin/user-service';

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

describe('admin support services', () => {
  describe('UserService', () => {
    it('searches users with pagination and mapped profile fields', async () => {
      const prisma = {
        user: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'user-1',
              email: 'user@example.com',
              username: 'userone',
              firstName: 'User',
              lastName: 'One',
              isRootAdmin: false,
              authProvider: 'EMAIL',
              isActive: true,
              timezone: null,
              locale: null,
              timeFormat: null,
              dateFormat: null,
              createdAt: new Date('2026-04-21T00:00:00.000Z'),
            },
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
      } as any;

      const service = new UserService(prisma, createLogger() as any);

      await expect(service.searchUsers({ search: 'user', page: 2, pageSize: 10 })).resolves.toEqual(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              id: 'user-1',
              email: 'user@example.com',
              username: 'userone',
              authProvider: 'email',
            }),
          ]),
          total: 1,
        }),
      );
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        skip: 10,
        take: 10,
      }));
    });

    it('loads user detail and throws when the user is missing', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn()
            .mockResolvedValueOnce({
              id: 'user-1',
              email: 'user@example.com',
              username: 'userone',
              firstName: 'User',
              lastName: 'One',
              isRootAdmin: false,
              authProvider: 'EMAIL',
              isActive: true,
              timezone: null,
              locale: null,
              timeFormat: null,
              dateFormat: null,
              createdAt: new Date('2026-04-21T00:00:00.000Z'),
            })
            .mockResolvedValueOnce(null),
        },
      } as any;

      const service = new UserService(prisma, createLogger() as any);

      await expect(service.getUserDetail('user-1')).resolves.toEqual(
        expect.objectContaining({ id: 'user-1', username: 'userone' }),
      );
      await expect(service.getUserDetail('missing-user')).rejects.toBeInstanceOf(UserNotFoundError);
    });

    it('force-logs out a user and rejects missing users', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn()
            .mockResolvedValueOnce({ id: 'user-1' })
            .mockResolvedValueOnce(null),
        },
        refreshToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        },
      } as any;

      const service = new UserService(prisma, createLogger() as any);

      await expect(
        service.forceUserLogout('user-1', 'admin-1', 'admin@example.com'),
      ).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      await expect(
        service.forceUserLogout('missing-user', 'admin-1', 'admin@example.com'),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });

  describe('audit query service', () => {
    beforeEach(() => {
      setAuditQueryLogger(createLogger() as any);
    });

    it('queries audit entries with pagination and actor-name mapping', async () => {
      const prisma = {
        adminAuditEntry: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'entry-1',
              actorEmail: 'admin@example.com',
              action: 'user.disable',
              resourceType: 'USER',
              resourceId: 'user-1',
              description: 'Disabled user user-1',
              reason: null,
              ipAddress: '127.0.0.1',
              createdAt: new Date('2026-04-21T00:00:00.000Z'),
              beforeState: null,
              afterState: { isActive: false },
              actor: { firstName: 'Admin', lastName: 'User' },
            },
          ]),
          count: jest.fn().mockResolvedValue(1),
          findUnique: jest.fn(),
        },
      } as any;
      setAuditQueryPrisma(prisma);

      await expect(queryAuditLog({ search: 'user', page: 2, pageSize: 10 })).resolves.toEqual({
        items: [
          expect.objectContaining({
            id: 'entry-1',
            actorName: 'Admin User',
            hasStateChanges: true,
          }),
        ],
        total: 1,
        page: 2,
        pageSize: 10,
      });
    });

    it('returns null for missing audit entries and exports csv for matching entries', async () => {
      const prisma = {
        adminAuditEntry: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'entry-1',
              actorEmail: 'admin@example.com',
              action: 'user.enable',
              resourceType: 'USER',
              resourceId: 'user-1',
              description: 'Enabled user user-1',
              reason: 'support case',
              ipAddress: null,
              createdAt: new Date('2026-04-21T00:00:00.000Z'),
              beforeState: null,
              afterState: null,
              actor: null,
            },
          ]),
          count: jest.fn().mockResolvedValue(1),
          findUnique: jest.fn().mockResolvedValueOnce(null),
        },
      } as any;
      setAuditQueryPrisma(prisma);

      await expect(getAuditEntryById('missing-entry')).resolves.toBeNull();
      await expect(exportAuditLogCsv({ action: 'user.enable' })).resolves.toContain('"user.enable"');
    });
  });

  describe('HealthService', () => {
    it('reports degraded postgres health when the probe fails', async () => {
      const prisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error('postgres down')),
      } as any;

      const service = new HealthService(prisma, createLogger() as any);

      await expect(service.getServiceHealth()).resolves.toEqual([
        expect.objectContaining({
          status: 'DEGRADED',
          dependencies: [
            expect.objectContaining({
              name: 'PostgreSQL',
              status: 'DOWN',
            }),
          ],
        }),
      ]);
    });

    it('returns business metrics and stable not-found errors for missing health artifacts', async () => {
      const prisma = {
        $queryRaw: jest.fn().mockResolvedValue(undefined),
        user: { count: jest.fn().mockResolvedValue(12) },
        contest: { count: jest.fn().mockResolvedValue(3) },
        draftSession: { count: jest.fn().mockResolvedValue(2) },
      } as any;

      const service = new HealthService(prisma, createLogger() as any);

      await expect(service.getBusinessMetrics()).resolves.toEqual(
        expect.objectContaining({
          activeUsersLast24h: 12,
          activeContests: 3,
          liveDrafts: 2,
        }),
      );
      await expect(service.getErrorDetail('missing-error')).rejects.toMatchObject({
        name: 'ErrorLogEntryNotFoundError',
      });
      await expect(service.updateAlertRule('missing-alert', {})).rejects.toMatchObject({
        name: 'AlertRuleNotFoundError',
      });
    });
  });

  describe('platform config services', () => {
    it('updates and resets poll config', async () => {
      const service = new PollConfigService(createLogger() as any);

      await expect(service.updateConfig({ draft: 15000 }, 'admin-1', 'admin@example.com')).resolves.toEqual(
        expect.objectContaining({ draft: 15000 }),
      );
      await expect(service.resetDefaults('admin-1', 'admin@example.com')).resolves.toEqual(
        expect.objectContaining({ draft: 10000 }),
      );
    });

    it('updates ingestion config, resolves per-sport overrides, and resets defaults', async () => {
      const service = new IngestionConfigService(createLogger() as any);

      await expect(
        service.updateConfig({ liveScorePollingIntervalSeconds: 45 }, 'admin-1', 'admin@example.com'),
      ).resolves.toEqual(expect.objectContaining({ liveScorePollingIntervalSeconds: 45 }));
      await expect(
        service.setPerSportOverride('GOLF', { rankingSyncIntervalHours: 6 }, 'admin-1', 'admin@example.com'),
      ).resolves.toEqual(expect.objectContaining({
        perSportOverrides: expect.objectContaining({
          GOLF: expect.objectContaining({ rankingSyncIntervalHours: 6 }),
        }),
      }));
      await expect(service.getPerSportConfig('GOLF')).resolves.toEqual(
        expect.objectContaining({ rankingSyncIntervalHours: 6 }),
      );
      await expect(service.resetDefaults('admin-1', 'admin@example.com')).resolves.toEqual(
        expect.objectContaining({ liveScorePollingIntervalSeconds: 30 }),
      );
    });
  });
});
