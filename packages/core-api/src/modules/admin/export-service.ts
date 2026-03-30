/**
 * ExportService — tenant data export for admin / compliance purposes.
 *
 * Supports triggering a full data export for a tenant, checking export status,
 * and downloading the export payload. Uses an in-memory Map for transient
 * export state tracking (exports are short-lived operations) but queries
 * real data from Prisma for the actual export payload.
 */

import type { PrismaClient } from '@prisma/client';
import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface TenantExport {
  exportId: string;
  tenantId: string;
  status: ExportStatus;
  requestedBy: string;
  requestedAt: Date;
  completedAt?: Date;
  downloadUrl?: string;
  fileSizeBytes?: number;
  recordCounts?: {
    users: number;
    leagues: number;
    contests: number;
    entries: number;
    scores: number;
    auditLogs: number;
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ExportNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`No export found for tenant: ${tenantId}`);
    this.name = 'ExportNotFoundError';
  }
}

export class ExportNotReadyError extends Error {
  constructor(exportId: string) {
    super(`Export not ready for download: ${exportId}`);
    this.name = 'ExportNotReadyError';
  }
}

// ---------------------------------------------------------------------------
// In-memory store for transient export state
// ---------------------------------------------------------------------------

const exportStore = new Map<string, TenantExport>();

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ExportService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Triggers a data export for the given tenant. Queries real record counts
   * from the database and marks the export as COMPLETED.
   */
  async startExport(
    tenantId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<TenantExport> {
    const exportId = `export-${tenantId}-${Date.now()}`;
    const now = new Date();

    // Query real counts from the database
    const [userCount, leagueCount, contestCount, entryCount] = await Promise.all([
      this.prisma.user.count({ where: { tenantId } }),
      this.prisma.league.count({ where: { tenantId } }),
      this.prisma.contest.count({
        where: { league: { tenantId } },
      }),
      this.prisma.contestEntry.count({
        where: { contest: { league: { tenantId } } },
      }),
    ]);

    const tenantExport: TenantExport = {
      exportId,
      tenantId,
      status: 'COMPLETED',
      requestedBy: adminUserId,
      requestedAt: now,
      completedAt: now,
      downloadUrl: `/api/v1/admin/tenants/${tenantId}/export/download`,
      fileSizeBytes: 0, // Will be set after actual file generation
      recordCounts: {
        users: userCount,
        leagues: leagueCount,
        contests: contestCount,
        entries: entryCount,
        scores: 0, // Standings/scores count deferred until NoSQL integration
        auditLogs: 0,
      },
    };

    exportStore.set(tenantId, tenantExport);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'export.start',
      resourceType: 'TENANT',
      resourceId: tenantId,
      description: `Started data export for tenant ${tenantId}`,
      afterState: { exportId, status: tenantExport.status },
    });

    return tenantExport;
  }

  /**
   * Returns the current export status for a tenant.
   */
  async getExportStatus(tenantId: string): Promise<TenantExport> {
    const tenantExport = exportStore.get(tenantId);
    if (!tenantExport) throw new ExportNotFoundError(tenantId);
    return tenantExport;
  }

  /**
   * Returns the export data payload. Only available when status is COMPLETED.
   * Queries real data from Prisma.
   */
  async getExportData(tenantId: string): Promise<Record<string, unknown>> {
    const tenantExport = exportStore.get(tenantId);
    if (!tenantExport) throw new ExportNotFoundError(tenantId);
    if (tenantExport.status !== 'COMPLETED') {
      throw new ExportNotReadyError(tenantExport.exportId);
    }

    const [users, leagues, contests] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
        },
      }),
      this.prisma.league.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: { select: { memberships: true } },
        },
      }),
      this.prisma.contest.findMany({
        where: { league: { tenantId } },
        select: {
          id: true,
          leagueId: true,
          name: true,
          status: true,
          sport: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      exportId: tenantExport.exportId,
      tenantId,
      exportedAt: tenantExport.completedAt?.toISOString(),
      data: {
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          joinedAt: u.createdAt.toISOString().slice(0, 10),
        })),
        leagues: leagues.map((l) => ({
          id: l.id,
          name: l.name,
          memberCount: l._count.memberships,
        })),
        contests: contests.map((c) => ({
          id: c.id,
          leagueId: c.leagueId,
          name: c.name,
          status: c.status,
          sport: c.sport,
        })),
      },
    };
  }
}
