/**
 * AdminAuditService — immutable audit logging for all admin actions.
 *
 * Every admin operation (tenant management, user actions, contest overrides, etc.)
 * is recorded here with full before/after state and the reason for the action.
 *
 * Persisted via Prisma to the admin_audit_log table.
 */

import type { PrismaClient } from '@prisma/client';

export interface AuditLogParams {
  adminUserId: string;
  adminUserEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AdminAuditEntry {
  id: string;
  adminUserId: string;
  adminUserEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  reason?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

export interface AuditListQuery {
  adminUserId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  search?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Singleton Prisma reference (set once via AdminAuditService constructor)
// ---------------------------------------------------------------------------

let _prisma: PrismaClient | null = null;

/**
 * Sets the shared PrismaClient used by the module-level logAdminAction helper.
 */
export function setAuditPrisma(prisma: PrismaClient): void {
  _prisma = prisma;
}

/**
 * Logs an admin action to the immutable audit trail.
 *
 * This is a module-level helper so every service can call it without
 * needing its own reference to PrismaClient.
 */
export async function logAdminAction(params: AuditLogParams): Promise<void> {
  if (!_prisma) {
    // Fallback to console if Prisma not initialised yet (e.g. during tests)
    console.warn('[ADMIN_AUDIT] PrismaClient not set — logging to console only');
    console.info('[ADMIN_AUDIT]', {
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      adminUserEmail: params.adminUserEmail,
      description: params.description,
      reason: params.reason,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  await _prisma.adminAuditEntry.create({
    data: {
      actorId: params.adminUserId,
      actorEmail: params.adminUserEmail,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      description: params.description,
      beforeState: params.beforeState
        ? (params.beforeState as unknown as object)
        : undefined,
      afterState: params.afterState
        ? (params.afterState as unknown as object)
        : undefined,
      reason: params.reason,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}

/**
 * Retrieves audit log entries with filtering and pagination.
 */
export async function listAuditEntries(
  filters: AuditListQuery,
): Promise<{ items: AdminAuditEntry[]; total: number }> {
  if (!_prisma) {
    return { items: [], total: 0 };
  }

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};

  if (filters.adminUserId) {
    where.actorId = filters.adminUserId;
  }
  if (filters.action) {
    where.action = filters.action;
  }
  if (filters.resourceType) {
    where.resourceType = filters.resourceType;
  }
  if (filters.resourceId) {
    where.resourceId = filters.resourceId;
  }
  if (filters.startDate || filters.endDate) {
    const createdAt: Record<string, Date> = {};
    if (filters.startDate) createdAt.gte = filters.startDate;
    if (filters.endDate) createdAt.lte = filters.endDate;
    where.createdAt = createdAt;
  }
  if (filters.search) {
    where.description = { contains: filters.search, mode: 'insensitive' };
  }

  const [rows, total] = await Promise.all([
    _prisma.adminAuditEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    _prisma.adminAuditEntry.count({ where }),
  ]);

  const items: AdminAuditEntry[] = rows.map((r) => ({
    id: r.id,
    adminUserId: r.actorId,
    adminUserEmail: r.actorEmail,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    description: r.description,
    beforeState: r.beforeState as Record<string, unknown> | undefined,
    afterState: r.afterState as Record<string, unknown> | undefined,
    reason: r.reason ?? undefined,
    ipAddress: r.ipAddress ?? '',
    userAgent: r.userAgent ?? '',
    timestamp: r.createdAt,
  }));

  return { items, total };
}
