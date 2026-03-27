/**
 * ComplianceService — consent, age verification, data export, account deletion,
 * self-exclusion, enforcement, and retention.
 *
 * Option A: No real money on platform. Free at launch.
 */

import type { PrismaClient } from '@prisma/client';

// --- Age Verification ---

const MINIMUM_AGE = 13;

export function verifyAge(birthYear: number): { allowed: boolean; age: number; reason?: string } {
  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear;
  if (age < MINIMUM_AGE) {
    return { allowed: false, age, reason: `Must be ${MINIMUM_AGE} or older` };
  }
  return { allowed: true, age };
}

// --- Main Service ---

export class ComplianceService {
  constructor(private readonly prisma: PrismaClient) {}

  // --- Consent ---

  async recordConsent(params: {
    userId: string;
    consentType: string;
    granted: boolean;
    version: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.consentRecord.create({
      data: {
        userId: params.userId,
        consentType: params.consentType,
        granted: params.granted,
        version: params.version,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  }

  async getConsentHistory(userId: string): Promise<unknown[]> {
    return this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async hasActiveConsent(userId: string, consentType: string): Promise<boolean> {
    const latest = await this.prisma.consentRecord.findFirst({
      where: { userId, consentType },
      orderBy: { createdAt: 'desc' },
    });
    return latest?.granted ?? false;
  }

  // --- Data Export (GDPR Article 20 / CCPA) ---

  async requestDataExport(userId: string): Promise<string> {
    const request = await this.prisma.dataExportRequest.create({
      data: { userId, status: 'PENDING' },
    });
    return request.id;
  }

  async processDataExport(requestId: string): Promise<Record<string, unknown>> {
    const request = await this.prisma.dataExportRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new Error('Export request not found');

    const userId = request.userId;

    // Gather all user data
    const [profile, leagues, contests, picks, notifications, devices, consents] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.leagueMembership.findMany({ where: { userId } }),
      this.prisma.contestEntry.findMany({ where: { membership: { userId } } }),
      this.prisma.rosterPick.findMany({ where: { entry: { membership: { userId } } } }),
      this.prisma.notification.findMany({ where: { userId }, take: 1000 }),
      this.prisma.deviceRegistration.findMany({ where: { userId } }),
      this.prisma.consentRecord.findMany({ where: { userId } }),
    ]);

    const exportData = {
      profile,
      leagues,
      contests,
      picks,
      notifications: notifications.length,
      devices: devices.map((d: any) => ({ platform: d.platform, registeredAt: d.registeredAt })),
      consents,
      exportedAt: new Date().toISOString(),
    };

    await this.prisma.dataExportRequest.update({
      where: { id: requestId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    return exportData;
  }

  // --- Account Deletion (GDPR Article 17) ---

  async requestDeletion(userId: string, reason?: string): Promise<string> {
    const scheduledAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14-day wait
    const request = await this.prisma.deletionRequest.create({
      data: {
        userId,
        reason,
        status: 'PENDING',
        scheduledDeletionAt: scheduledAt,
      },
    });
    return request.id;
  }

  async cancelDeletion(requestId: string): Promise<void> {
    await this.prisma.deletionRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  async processPendingDeletions(): Promise<number> {
    const due = await this.prisma.deletionRequest.findMany({
      where: { status: 'PENDING', scheduledDeletionAt: { lte: new Date() } },
    });

    let processed = 0;
    for (const request of due) {
      await this.anonymiseUser(request.userId);
      await this.prisma.deletionRequest.update({
        where: { id: request.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      processed++;
    }
    return processed;
  }

  private async anonymiseUser(userId: string): Promise<void> {
    // Anonymise profile
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${userId}@anonymised.poolmaster`,
        displayName: 'Deleted User',
        authProvider: null,
        authId: null,
      },
    });

    // Delete personal data
    await this.prisma.notification.deleteMany({ where: { userId } });
    await this.prisma.deviceRegistration.deleteMany({ where: { userId } });
    await this.prisma.notificationPreference.deleteMany({ where: { userId } });

    // Contest standings and results remain anonymised (display name = "Deleted User")
  }

  // --- Self-Exclusion ---

  async createSelfExclusion(userId: string, type: 'COOL_DOWN' | 'SELF_EXCLUSION', duration: string): Promise<string> {
    const durationMs: Record<string, number> = {
      '24H': 24 * 60 * 60 * 1000,
      '7D': 7 * 24 * 60 * 60 * 1000,
      '30D': 30 * 24 * 60 * 60 * 1000,
      '6M': 180 * 24 * 60 * 60 * 1000,
      '1Y': 365 * 24 * 60 * 60 * 1000,
    };

    const endsAt = durationMs[duration]
      ? new Date(Date.now() + durationMs[duration])
      : undefined; // INDEFINITE

    const exclusion = await this.prisma.selfExclusion.create({
      data: { userId, exclusionType: type, duration, endsAt, isActive: true },
    });
    return exclusion.id;
  }

  async getActiveExclusion(userId: string): Promise<unknown | null> {
    return this.prisma.selfExclusion.findFirst({
      where: { userId, isActive: true },
      orderBy: { startedAt: 'desc' },
    });
  }

  async reactivateUser(exclusionId: string): Promise<void> {
    await this.prisma.selfExclusion.update({
      where: { id: exclusionId },
      data: { isActive: false, reactivatedAt: new Date() },
    });
  }

  async processExpiredExclusions(): Promise<number> {
    const expired = await this.prisma.selfExclusion.findMany({
      where: { isActive: true, exclusionType: 'COOL_DOWN', endsAt: { lte: new Date() } },
    });
    for (const ex of expired) {
      await this.prisma.selfExclusion.update({
        where: { id: ex.id },
        data: { isActive: false, reactivatedAt: new Date() },
      });
    }
    return expired.length;
  }

  // --- Account Enforcement ---

  async enforceAction(params: {
    userId: string;
    level: 'WARNING' | 'TEMPORARY_SUSPENSION' | 'PERMANENT_BAN';
    reason: string;
    trigger: string;
    enforcedBy?: string;
    durationDays?: number;
  }): Promise<string> {
    const endsAt = params.durationDays
      ? new Date(Date.now() + params.durationDays * 24 * 60 * 60 * 1000)
      : undefined;

    const enforcement = await this.prisma.accountEnforcement.create({
      data: {
        userId: params.userId,
        level: params.level,
        reason: params.reason,
        trigger: params.trigger,
        enforcedBy: params.enforcedBy,
        endsAt,
      },
    });
    return enforcement.id;
  }

  async getEnforcementHistory(userId: string): Promise<unknown[]> {
    return this.prisma.accountEnforcement.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateAppealStatus(enforcementId: string, status: 'PENDING' | 'GRANTED' | 'DENIED'): Promise<void> {
    await this.prisma.accountEnforcement.update({
      where: { id: enforcementId },
      data: { appealStatus: status },
    });
  }

  // --- Retention Cleanup ---

  async runRetentionCleanup(): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    const now = new Date();

    // Cleanup old notification delivery logs (90 days)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const deletedLogs = await this.prisma.notificationDeliveryLog.deleteMany({
      where: { createdAt: { lt: ninetyDaysAgo } },
    });
    results['notification_delivery_logs'] = deletedLogs.count;

    // Process pending deletions
    results['account_deletions'] = await this.processPendingDeletions();

    // Process expired cool-downs
    results['expired_exclusions'] = await this.processExpiredExclusions();

    // Log the run
    await this.prisma.retentionJobRun.create({
      data: {
        jobName: 'DAILY_RETENTION_CLEANUP',
        recordsProcessed: Object.values(results).reduce((a, b) => a + b, 0),
        recordsDeleted: results['notification_delivery_logs'] + results['account_deletions'],
        status: 'COMPLETED',
        completedAt: now,
      },
    });

    return results;
  }
}
