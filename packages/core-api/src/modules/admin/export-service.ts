/**
 * ExportService — tenant data export for admin / compliance purposes.
 *
 * Supports triggering a full data export for a tenant, checking export status,
 * and downloading the export payload. Mock implementation completes instantly
 * with sample JSON data.
 */

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
// In-memory store
// ---------------------------------------------------------------------------

const exportStore = new Map<string, TenantExport>();

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ExportService {
  /**
   * Triggers a data export for the given tenant. Mock implementation
   * completes instantly with simulated record counts.
   */
  async startExport(
    tenantId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<TenantExport> {
    const exportId = `export-${tenantId}-${Date.now()}`;
    const now = new Date();

    const tenantExport: TenantExport = {
      exportId,
      tenantId,
      status: 'COMPLETED',
      requestedBy: adminUserId,
      requestedAt: now,
      completedAt: now,
      downloadUrl: `/api/v1/admin/tenants/${tenantId}/export/download`,
      fileSizeBytes: 2_450_000,
      recordCounts: {
        users: 45,
        leagues: 8,
        contests: 24,
        entries: 360,
        scores: 14_400,
        auditLogs: 1_200,
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
   */
  async getExportData(tenantId: string): Promise<Record<string, unknown>> {
    const tenantExport = exportStore.get(tenantId);
    if (!tenantExport) throw new ExportNotFoundError(tenantId);
    if (tenantExport.status !== 'COMPLETED') {
      throw new ExportNotReadyError(tenantExport.exportId);
    }

    // Mock export data
    return {
      exportId: tenantExport.exportId,
      tenantId,
      exportedAt: tenantExport.completedAt?.toISOString(),
      data: {
        users: [
          { id: 'user-001', email: 'alice@example.com', displayName: 'Alice', joinedAt: '2025-06-15' },
          { id: 'user-002', email: 'bob@example.com', displayName: 'Bob', joinedAt: '2025-07-01' },
        ],
        leagues: [
          { id: 'league-001', name: 'Office NFL Pool', sport: 'nfl', memberCount: 12 },
        ],
        contests: [
          { id: 'contest-001', leagueId: 'league-001', name: 'Week 1 Picks', status: 'COMPLETED' },
        ],
        scores: [
          { contestId: 'contest-001', userId: 'user-001', score: 85, rank: 1 },
          { contestId: 'contest-001', userId: 'user-002', score: 72, rank: 2 },
        ],
      },
    };
  }
}
