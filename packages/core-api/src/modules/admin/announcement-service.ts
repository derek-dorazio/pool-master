/**
 * AnnouncementService — manages global platform announcements.
 *
 * Supports creating, scheduling, activating, and deactivating announcements
 * that display as banners or notifications to all platform users.
 *
 * Persisted via Prisma to the global_announcements table.
 */

import type { PrismaClient } from '@prisma/client';
import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnnouncementType = 'BANNER' | 'NOTIFICATION' | 'BOTH';
export type AnnouncementSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AnnouncementTarget = 'ALL_USERS' | 'ALL_TENANTS' | 'SPECIFIC_TENANTS';

export interface Announcement {
  id: string;
  type: AnnouncementType;
  title: string;
  body: string;
  linkUrl?: string;
  linkText?: string;
  severity: AnnouncementSeverity;
  dismissable: boolean;
  target: AnnouncementTarget;
  targetTenantIds?: string[];
  startsAt: Date;
  endsAt?: Date;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAnnouncementInput {
  type: AnnouncementType;
  title: string;
  body: string;
  linkUrl?: string;
  linkText?: string;
  severity: AnnouncementSeverity;
  dismissable?: boolean;
  target?: AnnouncementTarget;
  targetTenantIds?: string[];
  startsAt?: string;
  endsAt?: string;
}

export interface UpdateAnnouncementInput {
  title?: string;
  body?: string;
  linkUrl?: string;
  linkText?: string;
  severity?: AnnouncementSeverity;
  dismissable?: boolean;
  target?: AnnouncementTarget;
  targetTenantIds?: string[];
  startsAt?: string;
  endsAt?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AnnouncementNotFoundError extends Error {
  constructor(id: string) {
    super(`Announcement not found: ${id}`);
    this.name = 'AnnouncementNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Row → domain mapping
// ---------------------------------------------------------------------------

interface AnnouncementRow {
  id: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  linkText: string | null;
  severity: string;
  dismissable: boolean;
  target: string;
  targetTenantIds: string[];
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
  createdById: string;
  createdAt: Date;
}

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    type: row.type as AnnouncementType,
    title: row.title,
    body: row.body,
    linkUrl: row.linkUrl ?? undefined,
    linkText: row.linkText ?? undefined,
    severity: row.severity as AnnouncementSeverity,
    dismissable: row.dismissable,
    target: row.target as AnnouncementTarget,
    targetTenantIds: row.targetTenantIds.length > 0 ? row.targetTenantIds : undefined,
    startsAt: row.startsAt,
    endsAt: row.endsAt ?? undefined,
    isActive: row.isActive,
    createdBy: row.createdById,
    createdAt: row.createdAt,
    // GlobalAnnouncement has no updatedAt column — use createdAt as fallback
    updatedAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AnnouncementService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists all announcements (active, scheduled, and expired).
   */
  async listAnnouncements(): Promise<Announcement[]> {
    const rows = await this.prisma.globalAnnouncement.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => toAnnouncement(r as unknown as AnnouncementRow));
  }

  /**
   * Returns a single announcement by ID.
   */
  async getAnnouncement(id: string): Promise<Announcement> {
    const row = await this.prisma.globalAnnouncement.findUnique({ where: { id } });
    if (!row) throw new AnnouncementNotFoundError(id);
    return toAnnouncement(row as unknown as AnnouncementRow);
  }

  /**
   * Creates a new announcement.
   */
  async createAnnouncement(
    input: CreateAnnouncementInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<Announcement> {
    const now = new Date();

    const row = await this.prisma.globalAnnouncement.create({
      data: {
        type: input.type,
        title: input.title,
        body: input.body,
        linkUrl: input.linkUrl ?? null,
        linkText: input.linkText ?? null,
        severity: input.severity,
        dismissable: input.dismissable ?? true,
        target: input.target ?? 'ALL_USERS',
        targetTenantIds: input.targetTenantIds ?? [],
        startsAt: input.startsAt ? new Date(input.startsAt) : now,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        isActive: false,
        createdById: adminUserId,
      },
    });

    const announcement = toAnnouncement(row as unknown as AnnouncementRow);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'announcement.create',
      resourceType: 'ANNOUNCEMENT',
      resourceId: row.id,
      description: `Created announcement: "${input.title}"`,
      afterState: { title: input.title, severity: input.severity, type: input.type },
    });

    return announcement;
  }

  /**
   * Updates an existing announcement.
   */
  async updateAnnouncement(
    id: string,
    input: UpdateAnnouncementInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<Announcement> {
    const existing = await this.prisma.globalAnnouncement.findUnique({ where: { id } });
    if (!existing) throw new AnnouncementNotFoundError(id);

    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = input.body;
    if (input.linkUrl !== undefined) data.linkUrl = input.linkUrl;
    if (input.linkText !== undefined) data.linkText = input.linkText;
    if (input.severity !== undefined) data.severity = input.severity;
    if (input.dismissable !== undefined) data.dismissable = input.dismissable;
    if (input.target !== undefined) data.target = input.target;
    if (input.targetTenantIds !== undefined) data.targetTenantIds = input.targetTenantIds;
    if (input.startsAt !== undefined) data.startsAt = new Date(input.startsAt);
    if (input.endsAt !== undefined) data.endsAt = new Date(input.endsAt);

    const row = await this.prisma.globalAnnouncement.update({
      where: { id },
      data,
    });

    const announcement = toAnnouncement(row as unknown as AnnouncementRow);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'announcement.update',
      resourceType: 'ANNOUNCEMENT',
      resourceId: id,
      description: `Updated announcement: "${announcement.title}"`,
      beforeState: { title: existing.title, severity: existing.severity },
      afterState: { title: announcement.title, severity: announcement.severity },
    });

    return announcement;
  }

  /**
   * Deletes an announcement.
   */
  async deleteAnnouncement(
    id: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const existing = await this.prisma.globalAnnouncement.findUnique({ where: { id } });
    if (!existing) throw new AnnouncementNotFoundError(id);

    await this.prisma.globalAnnouncement.delete({ where: { id } });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'announcement.delete',
      resourceType: 'ANNOUNCEMENT',
      resourceId: id,
      description: `Deleted announcement: "${existing.title}"`,
      beforeState: { title: existing.title },
    });
  }

  /**
   * Activates an announcement.
   */
  async activateAnnouncement(
    id: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<Announcement> {
    const existing = await this.prisma.globalAnnouncement.findUnique({ where: { id } });
    if (!existing) throw new AnnouncementNotFoundError(id);

    const row = await this.prisma.globalAnnouncement.update({
      where: { id },
      data: { isActive: true },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'announcement.activate',
      resourceType: 'ANNOUNCEMENT',
      resourceId: id,
      description: `Activated announcement: "${existing.title}"`,
      afterState: { isActive: true },
    });

    return toAnnouncement(row as unknown as AnnouncementRow);
  }

  /**
   * Deactivates an announcement.
   */
  async deactivateAnnouncement(
    id: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<Announcement> {
    const existing = await this.prisma.globalAnnouncement.findUnique({ where: { id } });
    if (!existing) throw new AnnouncementNotFoundError(id);

    const row = await this.prisma.globalAnnouncement.update({
      where: { id },
      data: { isActive: false },
    });

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'announcement.deactivate',
      resourceType: 'ANNOUNCEMENT',
      resourceId: id,
      description: `Deactivated announcement: "${existing.title}"`,
      afterState: { isActive: false },
    });

    return toAnnouncement(row as unknown as AnnouncementRow);
  }

  /**
   * Returns currently active announcements (for client consumption).
   * Only returns announcements where isActive=true and current time is within the schedule.
   */
  async getActiveAnnouncements(): Promise<Announcement[]> {
    const now = new Date();

    const rows = await this.prisma.globalAnnouncement.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [
          { endsAt: null },
          { endsAt: { gt: now } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => toAnnouncement(r as unknown as AnnouncementRow));
  }
}
