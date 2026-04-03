/**
 * SupportService — consolidated investigation data for support staff.
 *
 * This service is backed by persisted notification delivery logs, admin audit
 * entries, contest standings, and contest results. It no longer synthesizes
 * tenant incidents from static mock payloads.
 */

import type { PrismaClient } from '@prisma/client';
import { TenantNotFoundError } from './tenant-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantError {
  id: string;
  service: string;
  errorType: string;
  message: string;
  requestId: string;
  occurredAt: Date;
}

export interface NotificationFailure {
  id: string;
  eventType: string;
  channel: string;
  failureReason: string;
  userId: string;
  occurredAt: Date;
}

export interface SupportActivitySample {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  adminUserEmail: string;
  occurredAt: Date;
}

export interface ScoringStaleness {
  contestId: string;
  contestName: string;
  sport: string;
  lastScoringUpdate: Date;
  staleMinutes: number;
}

export interface TenantInvestigation {
  tenantId: string;
  recentErrors: TenantError[];
  notificationFailures: NotificationFailure[];
  recentActivity: SupportActivitySample[];
  scoringStaleness: ScoringStaleness[];
  pendingCorrections: number;
  failedWebhooks: number;
}

interface TenantScope {
  tenantId: string;
  userIds: string[];
  leagueIds: string[];
  contestIds: string[];
  activeContests: Array<{
    id: string;
    name: string;
    sport: string;
    updatedAt: Date;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFailedDelivery(row: {
  id: string;
  notificationEventId: string;
  channel: string;
  failedReason: string | null;
  userId: string;
  createdAt: Date;
}): NotificationFailure {
  return {
    id: row.id,
    eventType: row.notificationEventId,
    channel: row.channel,
    failureReason: row.failedReason ?? 'Delivery failed',
    userId: row.userId,
    occurredAt: row.createdAt,
  };
}

function toActivity(row: {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  adminUserEmail: string;
  createdAt: Date;
}): SupportActivitySample {
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    description: row.description,
    adminUserEmail: row.adminUserEmail,
    occurredAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SupportService {
  constructor(private readonly prisma: PrismaClient) {}

  private async loadTenantScope(tenantId: string): Promise<TenantScope> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new TenantNotFoundError(tenantId);
    }

    const [users, leagues, contests] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId },
        select: { id: true },
      }),
      this.prisma.league.findMany({
        where: { tenantId },
        select: { id: true },
      }),
      this.prisma.contest.findMany({
        where: {
          league: { tenantId },
          status: { in: ['ACTIVE', 'OPEN', 'IN_PROGRESS', 'DRAFT'] },
        },
        select: {
          id: true,
          name: true,
          sport: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      tenantId,
      userIds: users.map((row) => row.id),
      leagueIds: leagues.map((row) => row.id),
      contestIds: contests.map((row) => row.id),
      activeContests: contests.map((row) => ({
        id: row.id,
        name: row.name,
        sport: row.sport ?? 'unknown',
        updatedAt: row.updatedAt,
      })),
    };
  }

  private async loadNotificationFailures(userIds: string[]): Promise<NotificationFailure[]> {
    if (userIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.notificationDeliveryLog.findMany({
      where: {
        userId: { in: userIds },
        status: 'FAILED',
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    return rows.map((row) => toFailedDelivery(row)).slice(0, 10);
  }

  private async loadActivity(scope: TenantScope): Promise<SupportActivitySample[]> {
    const auditRows = await this.prisma.adminAuditEntry.findMany({
      where: {
        OR: [
          { resourceType: 'TENANT', resourceId: scope.tenantId },
          { resourceType: 'LEAGUE', resourceId: { in: scope.leagueIds } },
          { resourceType: 'CONTEST', resourceId: { in: scope.contestIds } },
          { resourceType: 'USER', resourceId: { in: scope.userIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return auditRows.map((row) => toActivity(row));
  }

  private async loadStaleness(scope: TenantScope): Promise<ScoringStaleness[]> {
    if (scope.activeContests.length === 0) {
      return [];
    }

    const now = new Date();
    const staleness = await Promise.all(
      scope.activeContests.map(async (contest) => {
        const [lastStanding, lastResult] = await Promise.all([
          this.prisma.contestStanding.findFirst({
            where: { contestId: contest.id },
            orderBy: { lastUpdatedAt: 'desc' },
            select: { lastUpdatedAt: true },
          }),
          this.prisma.contestResult.findFirst({
            where: { contestId: contest.id },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
          }),
        ]);

        const lastScoringUpdate = lastStanding?.lastUpdatedAt ?? lastResult?.updatedAt ?? contest.updatedAt;
        const staleMinutes = Math.max(0, Math.floor((now.getTime() - lastScoringUpdate.getTime()) / 60_000));

        return {
          contestId: contest.id,
          contestName: contest.name,
          sport: contest.sport,
          lastScoringUpdate,
          staleMinutes,
        };
      }),
    );

    return staleness.sort((a, b) => b.staleMinutes - a.staleMinutes);
  }

  private async loadRecentErrors(
    notificationFailures: NotificationFailure[],
    scoringStaleness: ScoringStaleness[],
  ): Promise<TenantError[]> {
    const staleThreshold = 15;
    const staleErrors = scoringStaleness
      .filter((row) => row.staleMinutes >= staleThreshold)
      .map<TenantError>((row) => ({
        id: `stale-${row.contestId}`,
        service: 'scoring-service',
        errorType: 'STALE_SCORING',
        message: `${row.contestName} has not been refreshed in ${row.staleMinutes} minutes`,
        requestId: row.contestId,
        occurredAt: row.lastScoringUpdate,
      }));

    const deliveryErrors = notificationFailures.map<TenantError>((row) => ({
      id: row.id,
      service: 'notification-delivery',
      errorType: 'DELIVERY_FAILURE',
      message: row.failureReason,
      requestId: row.eventType,
      occurredAt: row.occurredAt,
    }));

    return [...deliveryErrors, ...staleErrors]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 10);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async getInvestigation(tenantId: string): Promise<TenantInvestigation> {
    const scope = await this.loadTenantScope(tenantId);
    const [notificationFailures, scoringStaleness, recentActivity] = await Promise.all([
      this.loadNotificationFailures(scope.userIds),
      this.loadStaleness(scope),
      this.loadActivity(scope),
    ]);

    return {
      tenantId,
      recentErrors: await this.loadRecentErrors(notificationFailures, scoringStaleness),
      notificationFailures,
      recentActivity,
      scoringStaleness,
      pendingCorrections: await this.prisma.adminAuditEntry.count({
        where: {
          action: 'contest.override_score',
          resourceType: 'CONTEST',
          resourceId: { in: scope.contestIds },
        },
      }),
      failedWebhooks: notificationFailures.length,
    };
  }

  async getErrors(tenantId: string): Promise<TenantError[]> {
    const scope = await this.loadTenantScope(tenantId);
    const [notificationFailures, scoringStaleness] = await Promise.all([
      this.loadNotificationFailures(scope.userIds),
      this.loadStaleness(scope),
    ]);
    return this.loadRecentErrors(notificationFailures, scoringStaleness);
  }

  async getNotificationFailures(tenantId: string): Promise<NotificationFailure[]> {
    const scope = await this.loadTenantScope(tenantId);
    return this.loadNotificationFailures(scope.userIds);
  }

  async getActivity(tenantId: string): Promise<SupportActivitySample[]> {
    const scope = await this.loadTenantScope(tenantId);
    return this.loadActivity(scope);
  }
}
