/**
 * AdminAuditService — immutable audit logging for all admin actions.
 *
 * Every admin operation (tenant management, user actions, contest overrides, etc.)
 * is recorded here with full before/after state and the reason for the action.
 */

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

/**
 * Logs an admin action to the immutable audit trail.
 *
 * Placeholder: logs to console. Will be wired to admin_audit_log table via Prisma.
 */
export async function logAdminAction(params: AuditLogParams): Promise<void> {
  // TODO: Insert into admin_audit_log table via Prisma
  console.info('[ADMIN_AUDIT]', {
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    adminUserEmail: params.adminUserEmail,
    description: params.description,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Retrieves audit log entries with filtering and pagination.
 *
 * Placeholder: returns empty result set. Will be wired to admin_audit_log table via Prisma.
 */
export async function listAuditEntries(
  filters: AuditListQuery,
): Promise<{ items: AdminAuditEntry[]; total: number }> {
  // TODO: Query admin_audit_log table via Prisma with filters
  void filters;
  return { items: [], total: 0 };
}
