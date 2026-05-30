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
import { ProviderService } from '../../../packages/core-api/src/modules/admin/provider-service';
import { SyncOrchestrator } from '../../../packages/core-api/src/modules/ingestion/core/sync-orchestrator';
import { UserNotFoundError, UserService } from '../../../packages/core-api/src/modules/admin/user-service';
import { Sport } from '../../../packages/shared/domain';

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

async function flushMicrotasks(times = 5): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
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

      await expect(service.getUserDetail('user-1', 'admin-1')).resolves.toEqual(
        expect.objectContaining({
          id: 'user-1',
          username: 'userone',
          viewerAuthority: {
            self: false,
            rootAdmin: true,
            viewer: false,
          },
        }),
      );
      await expect(service.getUserDetail('missing-user', 'admin-1')).rejects.toBeInstanceOf(UserNotFoundError);
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
        service.updateConfig({
          scheduledSports: ['GOLF', 'TENNIS'],
          eventLiveScores: { intervalSeconds: 45 },
        }, 'admin-1', 'admin@example.com'),
      ).resolves.toEqual(expect.objectContaining({
        scheduledSports: ['GOLF', 'TENNIS'],
        eventLiveScores: expect.objectContaining({ intervalSeconds: 45 }),
      }));
      await expect(
        service.setPerSportOverride('GOLF', { participantRankings: { intervalMinutes: 360 } }, 'admin-1', 'admin@example.com'),
      ).resolves.toEqual(expect.objectContaining({
        perSportOverrides: expect.objectContaining({
          GOLF: expect.objectContaining({
            participantRankings: expect.objectContaining({ intervalMinutes: 360 }),
          }),
        }),
      }));
      await expect(service.getPerSportConfig('GOLF')).resolves.toEqual(
        expect.objectContaining({
          participantRankings: expect.objectContaining({ intervalMinutes: 360 }),
        }),
      );
      await expect(service.resetDefaults('admin-1', 'admin@example.com')).resolves.toEqual(
        expect.objectContaining({
          scheduledSports: ['GOLF'],
          eventLiveScores: expect.objectContaining({ intervalSeconds: 30 }),
        }),
      );
    });

    it('pool-master-r04 rejects manual sync for sports outside ingestion scheduledSports config', async () => {
      const registry = {
        getProvider: jest.fn().mockReturnValue({
          providerId: 'mock-contest-feed',
          providerName: 'Mock Contest Feed Provider',
          sportsCovered: [Sport.GOLF, Sport.TENNIS],
        }),
      };
      const ingestionConfigReader = {
        getConfig: jest.fn().mockResolvedValue({
          scheduledSports: [Sport.GOLF],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
          eventParticipants: { enabled: true, intervalMinutes: 720, leadDaysBeforeStart: 7 },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: true, intervalSeconds: 30 },
          eventResults: { enabled: true, intervalMinutes: 30 },
          perSportOverrides: {},
        }),
        getPerSportConfig: jest.fn(),
      };
      const service = new ProviderService(
        {} as any,
        registry as any,
        {} as any,
        createLogger() as any,
        ingestionConfigReader,
      );

      await expect(service.prepareSportSync({
        sport: Sport.TENNIS,
        feeds: ['EVENTSCHEDULE'],
      }, 'admin-1', 'admin@example.com')).rejects.toMatchObject({
        name: 'SportSyncNotConfiguredError',
      });
    });

    it('pool-master-rop.68.2.3 pool-master-rop.68.2.5 proves deferred manual sport sync uses the normalized window', async () => {
      const now = new Date('2026-05-30T12:00:00.000Z');
      let deferredSync: (() => void) | undefined;
      const setImmediateSpy = jest
        .spyOn(global, 'setImmediate')
        .mockImplementation((callback: () => void) => {
          deferredSync = callback;
          return 0 as unknown as NodeJS.Immediate;
        });
      const providerSyncRunCreate = jest.fn().mockImplementation(async ({ data }) => ({
        id: 'sync-run-1',
        providerId: data.providerId,
        sport: data.sport,
        eventId: data.eventId,
        status: data.status,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        createdAt: data.createdAt,
        payloadJson: data.payloadJson,
      }));
      const providerSyncRunUpdate = jest.fn().mockResolvedValue({});
      const registry = {
        getProvider: jest.fn().mockReturnValue({
          providerId: 'mock-contest-feed',
          providerName: 'Mock Contest Feed Provider',
          sportsCovered: [Sport.GOLF],
        }),
      };
      const scheduler = {
        runSportSync: jest.fn().mockResolvedValue([{
          jobType: 'EVENT_SCHEDULE_SYNC',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          status: 'COMPLETED',
          recordsProcessed: 1,
          errors: 0,
          errorLog: [],
          warnings: [],
          stats: { providerRecordsReturned: 1 },
        }]),
      };
      const ingestionConfigReader = {
        getConfig: jest.fn().mockResolvedValue({
          scheduledSports: [Sport.GOLF],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 45 },
          eventParticipants: { enabled: true, intervalMinutes: 720, leadDaysBeforeStart: 7 },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: true, intervalSeconds: 30 },
          eventResults: { enabled: true, intervalMinutes: 30 },
          perSportOverrides: {},
        }),
        getPerSportConfig: jest.fn().mockResolvedValue({
          scheduledSports: [Sport.GOLF],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 45 },
          eventParticipants: { enabled: true, intervalMinutes: 720, leadDaysBeforeStart: 7 },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: true, intervalSeconds: 30 },
          eventResults: { enabled: true, intervalMinutes: 30 },
          perSportOverrides: {},
        }),
      };
      const service = new ProviderService(
        {
          providerSyncRun: {
            create: providerSyncRunCreate,
            update: providerSyncRunUpdate,
          },
        } as any,
        registry as any,
        scheduler as any,
        createLogger() as any,
        ingestionConfigReader,
        undefined,
        undefined,
        new SyncOrchestrator({ now: () => now }),
      );

      try {
        const result = await service.prepareSportSync({
          sport: Sport.GOLF,
          feeds: ['EVENTSCHEDULE'],
        }, 'admin-1', 'admin@example.com');

        expect(result.requestedFeeds).toEqual(['EVENTSCHEDULE']);
        expect(providerSyncRunCreate).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
            sport: Sport.GOLF,
            eventId: null,
            payloadJson: expect.objectContaining({
              requestedFeed: 'EVENTSCHEDULE',
              requestPayload: expect.objectContaining({
                source: 'MANUAL',
                actor: {
                  type: 'ROOT_ADMIN',
                  userId: 'admin-1',
                  email: 'admin@example.com',
                },
                from: null,
                to: null,
                effectiveWindow: {
                  from: '2026-05-30T12:00:00.000Z',
                  to: '2026-07-14T12:00:00.000Z',
                  defaultedFrom: true,
                  defaultedTo: true,
                },
              }),
            }),
          }),
        }));
        const payloadJson = providerSyncRunCreate.mock.calls[0][0].data.payloadJson;
        expect(payloadJson).not.toHaveProperty('source');
        expect(payloadJson).not.toHaveProperty('actor');
        expect(payloadJson).not.toHaveProperty('effectiveWindow');
        expect(deferredSync).toBeDefined();
        deferredSync?.();
        await flushMicrotasks();
        expect(scheduler.runSportSync).toHaveBeenCalledWith({
          sport: Sport.GOLF,
          feeds: ['EVENTSCHEDULE'],
          from: new Date('2026-05-30T12:00:00.000Z'),
          to: new Date('2026-07-14T12:00:00.000Z'),
        });
      } finally {
        setImmediateSpy.mockRestore();
      }
    });

    it('pool-master-rop.68.2.3 normalizes manual event sync before submission', async () => {
      const now = new Date('2026-05-30T12:00:00.000Z');
      let deferredSync: (() => void) | undefined;
      const setImmediateSpy = jest
        .spyOn(global, 'setImmediate')
        .mockImplementation((callback: () => void) => {
          deferredSync = callback;
          return 0 as unknown as NodeJS.Immediate;
        });
      const providerSyncRunCreate = jest.fn().mockImplementation(async ({ data }) => ({
        id: 'sync-run-1',
        providerId: data.providerId,
        sport: data.sport,
        eventId: data.eventId,
        status: data.status,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        createdAt: data.createdAt,
        payloadJson: data.payloadJson,
      }));
      const providerSyncRunUpdate = jest.fn().mockResolvedValue({});
      const registry = {
        getProvider: jest.fn().mockReturnValue({
          providerId: 'mock-contest-feed',
          providerName: 'Mock Contest Feed Provider',
          sportsCovered: [Sport.GOLF],
          getEventDetails: jest.fn(),
          setMockEventState: jest.fn(),
        }),
      };
      const scheduler = {
        runEventSync: jest.fn().mockResolvedValue([{
          jobType: 'EVENT_LIVE_SCORES_SYNC',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          eventExternalId: 'golf-open-championship-2026',
          status: 'COMPLETED',
          recordsProcessed: 1,
          errors: 0,
          errorLog: [],
          warnings: [],
          stats: { liveScoreUpdatesReturned: 1 },
        }]),
      };
      const ingestionConfigReader = {
        getConfig: jest.fn().mockResolvedValue({
          scheduledSports: [Sport.GOLF],
          healthCheck: { enabled: true, intervalMinutes: 5 },
          eventSchedule: { enabled: true, intervalMinutes: 360, lookaheadDays: 30 },
          eventParticipants: { enabled: true, intervalMinutes: 720, leadDaysBeforeStart: 7 },
          participantRankings: { enabled: true, intervalMinutes: 1440 },
          eventLiveScores: { enabled: true, intervalSeconds: 30 },
          eventResults: { enabled: true, intervalMinutes: 30 },
          perSportOverrides: {},
        }),
        getPerSportConfig: jest.fn(),
      };
      const service = new ProviderService(
        {
          providerSyncRun: {
            create: providerSyncRunCreate,
            update: providerSyncRunUpdate,
          },
        } as any,
        registry as any,
        scheduler as any,
        createLogger() as any,
        ingestionConfigReader,
        undefined,
        undefined,
        new SyncOrchestrator({ now: () => now }),
      );

      try {
        const result = await service.syncEventData({
          sport: Sport.GOLF,
          eventId: '  golf-open-championship-2026  ',
          feeds: ['EVENTLIVESCORES', 'EVENTLIVESCORES'],
          mockEventState: 'live',
        }, 'admin-1', 'admin@example.com');

        expect(result.eventId).toBe('golf-open-championship-2026');
        expect(result.requestedFeeds).toEqual(['EVENTLIVESCORES']);
        expect(providerSyncRunCreate).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
            sport: Sport.GOLF,
            eventId: 'golf-open-championship-2026',
            payloadJson: expect.objectContaining({
              requestedFeeds: ['EVENTLIVESCORES'],
              requestedFeed: 'EVENTLIVESCORES',
              requestPayload: expect.objectContaining({
                source: 'MANUAL',
                actor: {
                  type: 'ROOT_ADMIN',
                  userId: 'admin-1',
                  email: 'admin@example.com',
                },
                mockEventState: 'live',
              }),
            }),
          }),
        }));
        const payloadJson = providerSyncRunCreate.mock.calls[0][0].data.payloadJson;
        expect(payloadJson).not.toHaveProperty('source');
        expect(payloadJson).not.toHaveProperty('actor');
        expect(payloadJson).not.toHaveProperty('mockEventState');
        expect(deferredSync).toBeDefined();
        deferredSync?.();
        await flushMicrotasks();
        expect(scheduler.runEventSync).toHaveBeenCalledWith({
          sport: Sport.GOLF,
          eventId: 'golf-open-championship-2026',
          feeds: ['EVENTLIVESCORES'],
          mockEventState: 'live',
        });
      } finally {
        setImmediateSpy.mockRestore();
      }
    });

  });
});
