/**
 * DunningService — handles failed payment recovery including retry
 * scheduling, grace periods, feature degradation, and auto-cancellation.
 *
 * The repo does not persist dunning events yet, so write-side operations are
 * intentionally unavailable. Read-side status/metrics are derived from the
 * current subscription rows instead of in-memory state.
 */

import type { PrismaClient } from '@prisma/client';
import { SubscriptionStatus } from '@poolmaster/shared/domain';
import { getDunningConfig } from '../admin/dunning-config-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DunningConfig {
  retryAttempts: { daysAfterFailure: number; action: string }[];
  gracePeriodDays: number;
  degradedPeriodDays: number;
  cancellationDays: number;
}

export type DunningPhase = 'NONE' | 'GRACE' | 'DEGRADED' | 'PENDING_CANCEL' | 'CANCELLED';

export interface DunningStatus {
  tenantId: string;
  phase: DunningPhase;
  failedAt: Date | null;
  retryCount: number;
  nextRetryAt: Date | null;
  gracePeriodEndsAt: Date | null;
  degradedPeriodEndsAt: Date | null;
  cancellationAt: Date | null;
}

export interface RetryResult {
  tenantId: string;
  invoiceId: string;
  attempt: number;
  isSuccessful: boolean;
  nextRetryAt: Date | null;
}

export interface EscalationResult {
  tenantId: string;
  previousPhase: DunningPhase;
  newPhase: DunningPhase;
  action: string;
}

export interface RecoveryMetrics {
  totalFailedPayments: number;
  recoveredPayments: number;
  recoveryRate: number;
  averageRecoveryDays: number;
  revenueRecoveredCents: number;
  revenueAtRiskCents: number;
}

export class DunningStateUnavailableError extends Error {
  constructor(operation: string) {
    super(`Dunning state is unavailable for ${operation} until payment-failure persistence exists`);
    this.name = 'DunningStateUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DunningConfig = {
  retryAttempts: [
    { daysAfterFailure: 1, action: 'RETRY_PAYMENT' },
    { daysAfterFailure: 3, action: 'RETRY_PAYMENT' },
    { daysAfterFailure: 5, action: 'RETRY_PAYMENT' },
    { daysAfterFailure: 7, action: 'RETRY_PAYMENT' },
  ],
  gracePeriodDays: 7,
  degradedPeriodDays: 14,
  cancellationDays: 21,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DunningService {
  private readonly config: DunningConfig;

  constructor(
    private readonly prisma: PrismaClient,
    config?: Partial<DunningConfig>,
  ) {
    const adminConfig = getDunningConfig();
    this.config = { ...DEFAULT_CONFIG, ...adminConfig, ...config };
  }

  async handlePaymentFailure(tenantId: string, invoiceId: string): Promise<void> {
    void tenantId;
    void invoiceId;
    throw new DunningStateUnavailableError('payment failure tracking');
  }

  async getDunningStatus(tenantId: string): Promise<DunningStatus> {
    const subscription = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
      select: {
        status: true,
        currentPeriodEnd: true,
        updatedAt: true,
      },
    });

    if (!subscription) {
      return {
        tenantId,
        phase: 'NONE',
        failedAt: null,
        retryCount: 0,
        nextRetryAt: null,
        gracePeriodEndsAt: null,
        degradedPeriodEndsAt: null,
        cancellationAt: null,
      };
    }

    if (
      subscription.status !== SubscriptionStatus.PAST_DUE
    ) {
      return {
        tenantId,
        phase: 'NONE',
        failedAt: null,
        retryCount: 0,
        nextRetryAt: null,
        gracePeriodEndsAt: null,
        degradedPeriodEndsAt: null,
        cancellationAt: null,
      };
    }

    const failedAt = subscription.currentPeriodEnd ?? subscription.updatedAt;
    const daysSinceFailure = this.computeDaysSince(failedAt);
    const phase = this.resolvePhase(daysSinceFailure);

    return {
      tenantId,
      phase,
      failedAt,
      retryCount: 0,
      nextRetryAt: this.addDays(failedAt, this.config.retryAttempts[0]?.daysAfterFailure ?? 1),
      gracePeriodEndsAt: this.addDays(failedAt, this.config.gracePeriodDays),
      degradedPeriodEndsAt: this.addDays(failedAt, this.config.degradedPeriodDays),
      cancellationAt: this.addDays(failedAt, this.config.cancellationDays),
    };
  }

  async processRetries(): Promise<RetryResult[]> {
    throw new DunningStateUnavailableError('retry processing');
  }

  async processEscalations(): Promise<EscalationResult[]> {
    throw new DunningStateUnavailableError('escalation processing');
  }

  async getRecoveryMetrics(): Promise<RecoveryMetrics> {
    const failedSubscriptions = await this.prisma.tenantSubscription.findMany({
      where: {
        status: {
          in: [SubscriptionStatus.PAST_DUE],
        },
      },
      select: {
        updatedAt: true,
        currentPeriodEnd: true,
      },
    });
    const recoveredSubscriptions = await this.prisma.tenantSubscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        trialStart: { not: null },
      },
      select: {
        trialStart: true,
      },
    });

    const totalFailed = failedSubscriptions.length;
    const recovered = recoveredSubscriptions.length;
    const totalRecoveryDays = recoveredSubscriptions.reduce((sum, entry) => {
      if (!entry.trialStart) {
        return sum;
      }
      return sum + this.computeDaysSince(entry.trialStart);
    }, 0);

    return {
      totalFailedPayments: totalFailed,
      recoveredPayments: recovered,
      recoveryRate: totalFailed > 0 ? Math.round((recovered / totalFailed) * 1000) / 10 : 0,
      averageRecoveryDays: recovered > 0
        ? Math.round((totalRecoveryDays / recovered) * 10) / 10
        : 0,
      revenueRecoveredCents: 0,
      revenueAtRiskCents: 0,
    };
  }

  private resolvePhase(daysSinceFailure: number): DunningPhase {
    if (daysSinceFailure >= this.config.cancellationDays) {
      return 'CANCELLED';
    }
    if (daysSinceFailure >= this.config.degradedPeriodDays) {
      return 'PENDING_CANCEL';
    }
    if (daysSinceFailure >= this.config.gracePeriodDays) {
      return 'DEGRADED';
    }
    return 'GRACE';
  }

  private computeDaysSince(date: Date): number {
    const diffMs = Date.now() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}
