/**
 * Quick actions handler — one-click support shortcuts for common scenarios.
 *
 * The actions now delegate to real backend services and persisted data instead
 * of returning canned support-staff examples.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ContestService } from './contest-service';
import { ContestNotFoundError } from './contest-service';
import type { ProviderService } from './provider-service';
import { ProviderNotFoundError } from './provider-service';
import type { UserService } from './user-service';
import { UserNotFoundError } from './user-service';
import type { EntitlementService } from '../billing/entitlement-service';

// ---------------------------------------------------------------------------
// Admin context helper
// ---------------------------------------------------------------------------

interface AdminContext {
  adminUserId: string;
  adminUserEmail: string;
}

function extractAdminContext(request: FastifyRequest): AdminContext {
  const adminUserId = request.headers['x-admin-user-id'] as string ?? '';
  const adminUserEmail = request.headers['x-admin-user-email'] as string ?? '';
  return { adminUserId, adminUserEmail };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ENTITLEMENT_KEYS = [
  'league.create',
  'league.member.add',
  'contest.create',
  'sport.access',
  'draft.type',
  'draft.mode',
  'leaderboard.realtime',
  'scoring.custom',
  'history.access',
  'analytics.access',
  'branding.custom',
  'prizes.intermediate',
  'api.access',
] as const;

type EntitlementKey = typeof ENTITLEMENT_KEYS[number];

export interface QuickActionsDeps {
  prisma: PrismaClient;
  userService: UserService;
  providerService: ProviderService;
  contestService: ContestService;
  entitlementService: EntitlementService;
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createQuickActionsHandlers(deps: QuickActionsDeps) {
  return {
    resetPassword,
    checkProvider,
    checkEntitlements,
    checkNotifications,
    reIngestScores,
  };

  // --- Reset password ---

  async function resetPassword(
    request: FastifyRequest<{ Body: { userId: string; email: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { userId, email } = request.body;

    try {
      await deps.userService.resetUserPassword(userId, adminUserId, adminUserEmail);
      return reply.send({
        action: 'reset-password',
        userId,
        email,
        result: 'PASSWORD_RESET_TRIGGERED',
        triggeredAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Check provider health ---

  async function checkProvider(
    request: FastifyRequest<{ Body: { providerId: string; sport: string } }>,
    reply: FastifyReply,
  ) {
    const { providerId, sport } = request.body;

    try {
      const detail = await deps.providerService.getProviderDetail(providerId);
      return reply.send({
        action: 'check-provider',
        requestedSport: sport,
        matchesSportCoverage: detail.sportsCovered.some((covered) => covered.toUpperCase() === sport.toUpperCase()),
        provider: {
          providerId: detail.providerId,
          providerName: detail.providerName,
          status: detail.status,
          errorRate: detail.errorRate,
          latencyMs: detail.latencyMs,
          lastEventAt: detail.lastEventAt,
          sportsCovered: detail.sportsCovered,
          activeEventCount: detail.activeEventCount,
        },
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof ProviderNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Check entitlements ---

  async function checkEntitlements(
    request: FastifyRequest<{ Body: { tenantId: string } }>,
    reply: FastifyReply,
  ) {
    const { tenantId } = request.body;
    const tenant = await deps.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planTier: true },
    });
    if (!tenant) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: `Tenant not found: ${tenantId}` });
    }

    const results = await deps.entitlementService.checkMultiple(tenantId, [...ENTITLEMENT_KEYS] as unknown as EntitlementKey[]);
    const entitlements: Record<string, unknown> = {};
    let withinLimits = true;
    for (const [key, result] of results) {
      entitlements[key] = result;
      withinLimits = withinLimits && result.entitled;
    }

    const [leagues, members, contests] = await Promise.all([
      deps.entitlementService.getUsage(tenantId, 'LEAGUES'),
      deps.entitlementService.getUsage(tenantId, 'MEMBERS'),
      deps.entitlementService.getUsage(tenantId, 'CONTESTS'),
    ]);

    return reply.send({
      action: 'check-entitlements',
      tenantId,
      planTier: tenant.planTier,
      entitlements,
      usage: { leagues, members, contests },
      withinLimits,
      checkedAt: new Date().toISOString(),
    });
  }

  // --- Check notifications ---

  async function checkNotifications(
    request: FastifyRequest<{ Body: { userId: string } }>,
    reply: FastifyReply,
  ) {
    const { userId } = request.body;
    const user = await deps.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: `User not found: ${userId}` });
    }

    const [prefs, devices, deliveryLogs] = await Promise.all([
      deps.prisma.notificationPreference.findUnique({ where: { userId } }),
      deps.prisma.deviceRegistration.findMany({
        where: { userId, isActive: true },
        orderBy: { lastActiveAt: 'desc' },
      }),
      deps.prisma.notificationDeliveryLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ]);

    const failed = deliveryLogs.filter((row) => row.status === 'FAILED');
    const sent = deliveryLogs.filter((row) => row.sentAt !== null || row.status !== 'FAILED').length;
    const delivered = deliveryLogs.filter((row) => row.deliveredAt !== null).length;
    const deliveryRate = deliveryLogs.length > 0 ? Number(((delivered / deliveryLogs.length) * 100).toFixed(1)) : 0;

    return reply.send({
      action: 'check-notifications',
      userId,
      preferences: {
        doNotDisturb: prefs?.doNotDisturb ?? false,
        categories: (prefs?.categoryPreferences as Record<string, boolean> | null) ?? {},
      },
      devices: devices.map((device) => ({
        platform: device.platform,
        lastSeen: device.lastActiveAt.toISOString(),
        tokenStatus: device.isActive ? 'ACTIVE' : 'INACTIVE',
      })),
      recentDelivery: {
        sent,
        delivered,
        failed: failed.length,
        deliveryRate,
      },
      failures: failed.slice(0, 10).map((row) => ({
        eventType: row.notificationEventId,
        channel: row.channel,
        reason: row.failedReason ?? row.suppressionReason ?? 'Delivery failed',
        at: row.createdAt.toISOString(),
      })),
      checkedAt: new Date().toISOString(),
    });
  }

  // --- Refresh scoring / recalculate standings ---

  async function reIngestScores(
    request: FastifyRequest<{ Body: { contestId: string; eventId: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const { contestId, eventId } = request.body;

    try {
      const result = await deps.contestService.recalculateStandings(contestId, adminUserId, adminUserEmail);
      return reply.send({
        action: 're-ingest-scores',
        ...result,
        eventId,
      });
    } catch (err) {
      if (err instanceof ContestNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }
}
