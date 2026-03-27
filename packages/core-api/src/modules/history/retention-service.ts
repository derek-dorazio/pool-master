/**
 * RetentionService — configurable data retention policies per league.
 *
 * Commissioners can configure how long history data is retained.
 * Default: keep everything forever. A scheduled job calls runCleanup
 * to enforce the policy.
 */

import type { PrismaClient } from '@prisma/client';

export interface RetentionConfig {
  leagueId: string;
  contestResultRetention: number;
  rosterHistoryRetention: number;
  activityLogRetention: number;
  payoutRecordRetention: number;
}

export interface CleanupResult {
  contestResultsDeleted: number;
  rosterHistoriesDeleted: number;
  activityLogsDeleted: number;
  payoutRecordsDeleted: number;
  runId: string;
}

export interface CleanupPreview {
  contestResultsToDelete: number;
  rosterHistoriesToDelete: number;
  activityLogsToDelete: number;
  payoutRecordsToDelete: number;
}

const DEFAULT_RETENTION: RetentionConfig = {
  leagueId: '',
  contestResultRetention: -1,
  rosterHistoryRetention: -1,
  activityLogRetention: 365,
  payoutRecordRetention: -1,
};

export class RetentionService {
  /**
   * In-memory store for retention configs. Used until the Prisma client is
   * regenerated with the RetentionConfig model.
   */
  private static readonly configStore = new Map<string, RetentionConfig>();

  constructor(private readonly prisma: PrismaClient) {}

  /** Get retention config for a league (returns defaults if not set). */
  async getConfig(leagueId: string): Promise<RetentionConfig> {
    const stored = RetentionService.configStore.get(leagueId);
    if (!stored) {
      return { ...DEFAULT_RETENTION, leagueId };
    }
    return stored;
  }

  /** Update retention config (commissioner only). */
  async updateConfig(
    leagueId: string,
    config: Partial<RetentionConfig>,
  ): Promise<RetentionConfig> {
    const existing = await this.getConfig(leagueId);

    const merged: RetentionConfig = {
      leagueId,
      contestResultRetention: config.contestResultRetention ?? existing.contestResultRetention,
      rosterHistoryRetention: config.rosterHistoryRetention ?? existing.rosterHistoryRetention,
      activityLogRetention: config.activityLogRetention ?? existing.activityLogRetention,
      payoutRecordRetention: config.payoutRecordRetention ?? existing.payoutRecordRetention,
    };

    RetentionService.configStore.set(leagueId, merged);
    return merged;
  }

  /** Preview what would be cleaned up without actually deleting. */
  async previewCleanup(leagueId: string): Promise<CleanupPreview> {
    const config = await this.getConfig(leagueId);
    const now = new Date();

    return {
      contestResultsToDelete: await this.countExpiredResults(leagueId, config, now),
      rosterHistoriesToDelete: await this.countExpiredRosters(leagueId, config, now),
      activityLogsToDelete: await this.countExpiredActivityLogs(leagueId, config, now),
      payoutRecordsToDelete: await this.countExpiredPayouts(leagueId, config, now),
    };
  }

  /** Run cleanup based on retention policy. Called by scheduled job. */
  async runCleanup(leagueId: string): Promise<CleanupResult> {
    const config = await this.getConfig(leagueId);
    const now = new Date();

    // Create a job run record
    const jobRun = await this.prisma.retentionJobRun.create({
      data: { jobName: `league-cleanup:${leagueId}`, status: 'RUNNING' },
    });

    let contestResultsDeleted = 0;
    let rosterHistoriesDeleted = 0;
    let activityLogsDeleted = 0;
    let payoutRecordsDeleted = 0;

    try {
      // Delete expired contest results
      if (config.contestResultRetention > 0) {
        const cutoff = seasonsAgoCutoff(config.contestResultRetention, now);
        const deleted = await this.prisma.contestResult.deleteMany({
          where: { leagueId, closedAt: { lt: cutoff } },
        });
        contestResultsDeleted = deleted.count;
      }

      // Delete expired roster histories
      if (config.rosterHistoryRetention > 0) {
        const cutoff = seasonsAgoCutoff(config.rosterHistoryRetention, now);
        const contestIds = await this.getContestIdsBefore(leagueId, cutoff);
        if (contestIds.length > 0) {
          const deleted = await this.prisma.teamRosterHistory.deleteMany({
            where: { contestId: { in: contestIds } },
          });
          rosterHistoriesDeleted = deleted.count;
        }
      }

      // Delete expired activity logs
      if (config.activityLogRetention > 0) {
        const cutoff = daysAgo(config.activityLogRetention, now);
        const deleted = await this.prisma.commissionerAuditLog.deleteMany({
          where: { leagueId, createdAt: { lt: cutoff } },
        });
        activityLogsDeleted = deleted.count;
      }

      // Delete expired payout records
      if (config.payoutRecordRetention > 0) {
        const cutoff = seasonsAgoCutoff(config.payoutRecordRetention, now);
        const deleted = await this.prisma.payoutHistory.deleteMany({
          where: { leagueId, createdAt: { lt: cutoff } },
        });
        payoutRecordsDeleted = deleted.count;
      }

      const totalDeleted = contestResultsDeleted + rosterHistoriesDeleted +
        activityLogsDeleted + payoutRecordsDeleted;

      await this.prisma.retentionJobRun.update({
        where: { id: jobRun.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          recordsProcessed: totalDeleted,
          recordsDeleted: totalDeleted,
        },
      });

      return {
        contestResultsDeleted,
        rosterHistoriesDeleted,
        activityLogsDeleted,
        payoutRecordsDeleted,
        runId: jobRun.id,
      };
    } catch (error) {
      await this.prisma.retentionJobRun.update({
        where: { id: jobRun.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private async countExpiredResults(
    leagueId: string,
    config: RetentionConfig,
    now: Date,
  ): Promise<number> {
    if (config.contestResultRetention <= 0) return 0;
    const cutoff = seasonsAgoCutoff(config.contestResultRetention, now);
    return this.prisma.contestResult.count({
      where: { leagueId, closedAt: { lt: cutoff } },
    });
  }

  private async countExpiredRosters(
    leagueId: string,
    config: RetentionConfig,
    now: Date,
  ): Promise<number> {
    if (config.rosterHistoryRetention <= 0) return 0;
    const cutoff = seasonsAgoCutoff(config.rosterHistoryRetention, now);
    const contestIds = await this.getContestIdsBefore(leagueId, cutoff);
    if (contestIds.length === 0) return 0;
    return this.prisma.teamRosterHistory.count({
      where: { contestId: { in: contestIds } },
    });
  }

  private async countExpiredActivityLogs(
    leagueId: string,
    config: RetentionConfig,
    now: Date,
  ): Promise<number> {
    if (config.activityLogRetention <= 0) return 0;
    const cutoff = daysAgo(config.activityLogRetention, now);
    return this.prisma.commissionerAuditLog.count({
      where: { leagueId, createdAt: { lt: cutoff } },
    });
  }

  private async countExpiredPayouts(
    leagueId: string,
    config: RetentionConfig,
    now: Date,
  ): Promise<number> {
    if (config.payoutRecordRetention <= 0) return 0;
    const cutoff = seasonsAgoCutoff(config.payoutRecordRetention, now);
    return this.prisma.payoutHistory.count({
      where: { leagueId, createdAt: { lt: cutoff } },
    });
  }

  private async getContestIdsBefore(leagueId: string, cutoff: Date): Promise<string[]> {
    const results = await this.prisma.contestResult.findMany({
      where: { leagueId, closedAt: { lt: cutoff } },
      select: { contestId: true },
      distinct: ['contestId'],
    });
    return results.map((r) => r.contestId);
  }
}

/** Approximate N seasons ago as N years back from now. */
function seasonsAgoCutoff(seasons: number, now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - seasons);
  return cutoff;
}

/** N days ago from now. */
function daysAgo(days: number, now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}
