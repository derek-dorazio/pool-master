/**
 * AdminAuditService — immutable audit logging for all admin actions.
 *
 * Every admin operation (tenant management, user actions, contest overrides, etc.)
 * is recorded here with full before/after state and the reason for the action.
 *
 * Persisted via Prisma to the admin_audit_log table.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

/**
 * A snapshot of domain state for the audit trail.
 *
 * Deliberately `object` rather than `Record<string, unknown>`: callers pass typed
 * domain objects and DTOs, and a TypeScript `interface` is not assignable to
 * `Record<string, unknown>` because interfaces get no implicit index signature.
 * That single assignability gap was the reason seventeen call sites each carried
 * their own double type assertion through `unknown`. Widening the parameter here
 * removes all of them.
 *
 * The JSON-safety conversion happens once, in `toAuditSnapshot` below.
 */
export type AuditSnapshot = object;

export interface AuditLogParams {
  actorUserId: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  beforeState?: AuditSnapshot;
  afterState?: AuditSnapshot;
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
  beforeState?: AuditSnapshot;
  afterState?: AuditSnapshot;
  reason?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Singleton Prisma reference (set once via AdminAuditService constructor)
// ---------------------------------------------------------------------------

let _prisma: PrismaClient | null = null;
let _logger: FastifyBaseLogger | null = null;

/**
 * Sets the shared PrismaClient used by the module-level logAdminAction helper.
 */
export function setAuditPrisma(prisma: PrismaClient): void {
  _prisma = prisma;
}

export function setAuditLogger(logger: FastifyBaseLogger): void {
  _logger = logger;
}

/**
 * Logs an admin action to the immutable audit trail.
 *
 * This is a module-level helper so every service can call it without
 * needing its own reference to PrismaClient.
 */
/**
 * Narrow an arbitrary domain object to the JSON shape the `Json` column accepts.
 *
 * The round-trip is not ceremony: it is what actually reaches the database, so
 * doing it explicitly makes the lossy parts visible (undefined keys dropped,
 * Dates stringified) instead of leaving them to Prisma's serializer. It also
 * establishes at runtime the JSON-safety that the compiler cannot prove, which
 * is the honest reason a single assertion remains here rather than at every
 * call site.
 */
function toAuditSnapshot(value: AuditSnapshot): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function logAdminAction(params: AuditLogParams): Promise<void> {
  if (!_prisma) {
    _logger?.warn({
      action: 'admin.audit.persistence_unavailable',
      data: {
        auditAction: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        actorEmail: params.actorEmail,
        description: params.description,
        reason: params.reason ?? null,
      },
    }, 'Admin audit persistence unavailable');
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
      beforeState: params.beforeState ? toAuditSnapshot(params.beforeState) : undefined,
      afterState: params.afterState ? toAuditSnapshot(params.afterState) : undefined,
      reason: params.reason,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}
