/**
 * AuditQueryService — read-only query service for the admin audit log.
 *
 * Separated from AdminAuditService (write side) to keep read/write concerns clean.
 * Reads directly from the persisted admin_audit_log table via Prisma.
 */

import type { PrismaClient } from '@prisma/client';
import { formatUserFullName } from '../../core/user-name';

export interface AuditListQuery {
  actorUserId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditEntryView {
  id: string;
  actorEmail: string;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  reason?: string;
  ipAddress?: string;
  createdAt: Date;
  hasStateChanges: boolean;
}

export interface AuditListResult {
  items: AuditEntryView[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

let prisma: PrismaClient | null = null;

export function setAuditQueryPrisma(client: PrismaClient): void {
  prisma = client;
}

function requirePrisma(): PrismaClient {
  if (!prisma) {
    throw new Error('AuditQueryService Prisma client has not been initialized');
  }
  return prisma;
}

function toAuditEntryView(row: {
  id: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  description: string;
  reason: string | null;
  ipAddress: string | null;
  createdAt: Date;
  beforeState: unknown;
  afterState: unknown;
  actor?: { firstName: string; lastName: string } | null;
}): AuditEntryView {
  return {
    id: row.id,
    actorEmail: row.actorEmail,
    actorName: row.actor ? formatUserFullName(row.actor.firstName, row.actor.lastName) : row.actorEmail,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    description: row.description,
    reason: row.reason ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    createdAt: row.createdAt,
    hasStateChanges: row.beforeState != null || row.afterState != null,
  };
}

export async function queryAuditLog(query: AuditListQuery): Promise<AuditListResult> {
  const db = requirePrisma();
  const page = Math.max(query.page ?? 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (query.actorUserId) where.actorId = query.actorUserId;
  if (query.action) where.action = query.action;
  if (query.resourceType) where.resourceType = query.resourceType;
  if (query.resourceId) where.resourceId = query.resourceId;
  if (query.dateFrom || query.dateTo) {
    const createdAt: Record<string, Date> = {};
    if (query.dateFrom) createdAt.gte = new Date(query.dateFrom);
    if (query.dateTo) createdAt.lte = new Date(query.dateTo);
    where.createdAt = createdAt;
  }
  if (query.search) {
    where.OR = [
      { description: { contains: query.search, mode: 'insensitive' } },
      { reason: { contains: query.search, mode: 'insensitive' } },
      { actorEmail: { contains: query.search, mode: 'insensitive' } },
      { resourceId: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.adminAuditEntry.findMany({
      where,
      include: {
        actor: {
          select: { firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    db.adminAuditEntry.count({ where }),
  ]);

  return {
    items: rows.map(toAuditEntryView),
    total,
    page,
    pageSize,
  };
}

export async function getAuditEntryById(entryId: string): Promise<AuditEntryView | null> {
  const db = requirePrisma();
  const row = await db.adminAuditEntry.findUnique({
    where: { id: entryId },
    include: {
      actor: {
        select: { firstName: true, lastName: true },
      },
    },
  });

  return row ? toAuditEntryView(row) : null;
}

export async function exportAuditLogCsv(query: AuditListQuery): Promise<string> {
  const result = await queryAuditLog({
    ...query,
    page: 1,
    pageSize: MAX_PAGE_SIZE,
  });

  const escapeCsv = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const header = [
    'id',
    'actorEmail',
    'actorName',
    'action',
    'resourceType',
    'resourceId',
    'description',
    'reason',
    'ipAddress',
    'createdAt',
    'hasStateChanges',
  ];

  const rows = result.items.map((item) => [
    item.id,
    item.actorEmail,
    item.actorName,
    item.action,
    item.resourceType,
    item.resourceId,
    item.description,
    item.reason ?? '',
    item.ipAddress ?? '',
    item.createdAt.toISOString(),
    item.hasStateChanges ? 'true' : 'false',
  ]);

  return [header, ...rows].map((row) => row.map((value) => escapeCsv(String(value))).join(',')).join('\n');
}
