import { createQuickActionsHandlers } from '../../../packages/core-api/src/modules/admin/quick-actions-handler';
import { ProviderNotFoundError } from '../../../packages/core-api/src/modules/admin/provider-service';

function createReply() {
  const reply: any = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
  return reply;
}

describe('quick actions handler', () => {
  it('delegates password resets to the user service', async () => {
    const deps = {
      prisma: {
        tenant: { findUnique: jest.fn() },
      },
      userService: {
        resetUserPassword: jest.fn().mockResolvedValue(undefined),
      },
      providerService: {
        getProviderDetail: jest.fn(),
      },
      contestService: {
        recalculateStandings: jest.fn(),
      },
    } as any;
    const handlers = createQuickActionsHandlers(deps);
    const reply = createReply();

    await handlers.resetPassword(
      { headers: { 'x-admin-user-id': 'admin-1', 'x-admin-user-email': 'admin@poolmaster.io' }, body: { userId: 'user-1', email: 'user@example.com' } } as any,
      reply,
    );

    expect(deps.userService.resetUserPassword).toHaveBeenCalledWith(
      'user-1',
      'admin-1',
      'admin@poolmaster.io',
    );
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      action: 'reset-password',
      userId: 'user-1',
      result: 'PASSWORD_RESET_TRIGGERED',
    }));
  });

  it('returns live provider health details', async () => {
    const deps = {
      prisma: {
        tenant: { findUnique: jest.fn() },
      },
      userService: {
        resetUserPassword: jest.fn(),
      },
      providerService: {
        getProviderDetail: jest.fn().mockResolvedValue({
          providerId: 'provider-1',
          providerName: 'ESPN',
          status: 'HEALTHY',
          errorRate: 0.5,
          latencyMs: 120,
          lastEventAt: new Date('2026-04-03T11:00:00Z'),
          sportsCovered: ['GOLF', 'NBA'],
          activeEventCount: 4,
        }),
      },
      contestService: {
        recalculateStandings: jest.fn(),
      },
    } as any;
    const handlers = createQuickActionsHandlers(deps);
    const reply = createReply();

    await handlers.checkProvider(
      { body: { providerId: 'provider-1', sport: 'golf' } } as any,
      reply,
    );

    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      action: 'check-provider',
      requestedSport: 'golf',
      matchesSportCoverage: true,
      provider: expect.objectContaining({
        providerName: 'ESPN',
        activeEventCount: 4,
      }),
    }));
  });

  it('returns a recalculation result for support re-ingest', async () => {
    const deps = {
      prisma: {
        tenant: { findUnique: jest.fn() },
      },
      userService: {
        resetUserPassword: jest.fn(),
      },
      providerService: {
        getProviderDetail: jest.fn(),
      },
      contestService: {
        recalculateStandings: jest.fn().mockResolvedValue({
          contestId: 'contest-1',
          entriesAffected: 2,
          rankChanges: [{ entryId: 'entry-1', oldRank: 2, newRank: 1 }],
          recalculatedAt: new Date('2026-04-03T11:45:00Z'),
        }),
      },
    } as any;
    const handlers = createQuickActionsHandlers(deps);
    const reply = createReply();

    await handlers.reIngestScores(
      { headers: { 'x-admin-user-id': 'admin-1', 'x-admin-user-email': 'admin@poolmaster.io' }, body: { contestId: 'contest-1', eventId: 'event-1' } } as any,
      reply,
    );

    expect(deps.contestService.recalculateStandings).toHaveBeenCalledWith(
      'contest-1',
      'admin-1',
      'admin@poolmaster.io',
    );
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      action: 're-ingest-scores',
      contestId: 'contest-1',
      eventId: 'event-1',
      entriesAffected: 2,
    }));
  });

  it('surfaces missing providers as 404s', async () => {
    const deps = {
      prisma: {
        tenant: { findUnique: jest.fn() },
      },
      userService: {
        resetUserPassword: jest.fn(),
      },
      providerService: {
        getProviderDetail: jest.fn().mockRejectedValue(new ProviderNotFoundError('missing-provider')),
      },
      contestService: {
        recalculateStandings: jest.fn(),
      },
    } as any;
    const handlers = createQuickActionsHandlers(deps);
    const reply = createReply();

    await handlers.checkProvider(
      { body: { providerId: 'missing-provider', sport: 'golf' } } as any,
      reply,
    );

    expect(reply.status).toHaveBeenCalledWith(404);
  });
});
