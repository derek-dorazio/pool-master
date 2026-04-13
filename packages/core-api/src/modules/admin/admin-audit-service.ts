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
  actorUserId: string;
  actorEmail: string;
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
  actorUserId: string;
  actorEmail: string;
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
      actorEmail: params.actorEmail,
      description: params.description,
      reason: params.reason,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  await _prisma.adminAuditEntry.create({
    data: {
      actorId: params.actorUserId,
      actorEmail: params.actorEmail,
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
