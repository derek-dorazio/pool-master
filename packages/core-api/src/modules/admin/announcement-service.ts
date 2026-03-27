/**
 * AnnouncementService — manages global platform announcements.
 *
 * Supports creating, scheduling, activating, and deactivating announcements
 * that display as banners or notifications to all platform users.
 */

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
// Mock data store
// ---------------------------------------------------------------------------

const announcements = new Map<string, Announcement>();

function seedMockData(): void {
  if (announcements.size > 0) return;

  const now = new Date();

  const scheduled: Announcement = {
    id: 'ann-001',
    type: 'BANNER',
    title: 'Scheduled maintenance tonight',
    body: 'Platform will be unavailable from 2-4am UTC for scheduled maintenance.',
    severity: 'WARNING',
    dismissable: true,
    target: 'ALL_USERS',
    startsAt: new Date(now.getTime() + 6 * 3_600_000),
    endsAt: new Date(now.getTime() + 10 * 3_600_000),
    isActive: false,
    createdBy: 'admin-001',
    createdAt: new Date(now.getTime() - 86_400_000),
    updatedAt: new Date(now.getTime() - 86_400_000),
  };

  const featureInfo: Announcement = {
    id: 'ann-002',
    type: 'NOTIFICATION',
    title: 'New feature: Salary Cap drafts',
    body: 'Salary Cap drafts are now available! Create a new contest to try them out.',
    linkUrl: '/contests/new',
    linkText: 'Create contest',
    severity: 'INFO',
    dismissable: true,
    target: 'ALL_USERS',
    startsAt: new Date(now.getTime() - 3_600_000),
    isActive: true,
    createdBy: 'admin-001',
    createdAt: new Date(now.getTime() - 3_600_000),
    updatedAt: new Date(now.getTime() - 3_600_000),
  };

  const outage: Announcement = {
    id: 'ann-003',
    type: 'BANNER',
    title: 'Data provider outage',
    body: 'We are experiencing issues with our golf scoring data provider. Scores may be delayed.',
    severity: 'CRITICAL',
    dismissable: false,
    target: 'ALL_USERS',
    startsAt: new Date(now.getTime() - 1_800_000),
    isActive: true,
    createdBy: 'admin-002',
    createdAt: new Date(now.getTime() - 1_800_000),
    updatedAt: new Date(now.getTime() - 1_800_000),
  };

  announcements.set(scheduled.id, scheduled);
  announcements.set(featureInfo.id, featureInfo);
  announcements.set(outage.id, outage);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AnnouncementService {
  constructor() {
    seedMockData();
  }

  /**
   * Lists all announcements (active, scheduled, and expired).
   */
  async listAnnouncements(): Promise<Announcement[]> {
    return Array.from(announcements.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /**
   * Returns a single announcement by ID.
   */
  async getAnnouncement(id: string): Promise<Announcement> {
    const ann = announcements.get(id);
    if (!ann) throw new AnnouncementNotFoundError(id);
    return ann;
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
    const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const announcement: Announcement = {
      id,
      type: input.type,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      linkText: input.linkText,
      severity: input.severity,
      dismissable: input.dismissable ?? true,
      target: input.target ?? 'ALL_USERS',
      targetTenantIds: input.targetTenantIds,
      startsAt: input.startsAt ? new Date(input.startsAt) : now,
      endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      isActive: false,
      createdBy: adminUserId,
      createdAt: now,
      updatedAt: now,
    };

    announcements.set(id, announcement);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'announcement.create',
      resourceType: 'ANNOUNCEMENT',
      resourceId: id,
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
    const existing = announcements.get(id);
    if (!existing) throw new AnnouncementNotFoundError(id);

    const updated: Announcement = {
      ...existing,
      title: input.title ?? existing.title,
      body: input.body ?? existing.body,
      linkUrl: input.linkUrl ?? existing.linkUrl,
      linkText: input.linkText ?? existing.linkText,
      severity: input.severity ?? existing.severity,
      dismissable: input.dismissable ?? existing.dismissable,
      target: input.target ?? existing.target,
      targetTenantIds: input.targetTenantIds ?? existing.targetTenantIds,
      startsAt: input.startsAt ? new Date(input.startsAt) : existing.startsAt,
      endsAt: input.endsAt ? new Date(input.endsAt) : existing.endsAt,
      updatedAt: new Date(),
    };

    announcements.set(id, updated);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'announcement.update',
      resourceType: 'ANNOUNCEMENT',
      resourceId: id,
      description: `Updated announcement: "${updated.title}"`,
      beforeState: { title: existing.title, severity: existing.severity },
      afterState: { title: updated.title, severity: updated.severity },
    });

    return updated;
  }

  /**
   * Deletes an announcement.
   */
  async deleteAnnouncement(
    id: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<void> {
    const existing = announcements.get(id);
    if (!existing) throw new AnnouncementNotFoundError(id);

    announcements.delete(id);

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
    const existing = announcements.get(id);
    if (!existing) throw new AnnouncementNotFoundError(id);

    existing.isActive = true;
    existing.updatedAt = new Date();
    announcements.set(id, existing);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'announcement.activate',
      resourceType: 'ANNOUNCEMENT',
      resourceId: id,
      description: `Activated announcement: "${existing.title}"`,
      afterState: { isActive: true },
    });

    return existing;
  }

  /**
   * Deactivates an announcement.
   */
  async deactivateAnnouncement(
    id: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<Announcement> {
    const existing = announcements.get(id);
    if (!existing) throw new AnnouncementNotFoundError(id);

    existing.isActive = false;
    existing.updatedAt = new Date();
    announcements.set(id, existing);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'announcement.deactivate',
      resourceType: 'ANNOUNCEMENT',
      resourceId: id,
      description: `Deactivated announcement: "${existing.title}"`,
      afterState: { isActive: false },
    });

    return existing;
  }

  /**
   * Returns currently active announcements (for client consumption).
   * Only returns announcements where isActive=true and current time is within the schedule.
   */
  async getActiveAnnouncements(): Promise<Announcement[]> {
    const now = new Date();
    return Array.from(announcements.values()).filter((ann) => {
      if (!ann.isActive) return false;
      if (ann.startsAt > now) return false;
      if (ann.endsAt && ann.endsAt < now) return false;
      return true;
    });
  }
}
