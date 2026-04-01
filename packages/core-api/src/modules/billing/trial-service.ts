/**
 * TrialService — manages 14-day trial lifecycle using TenantSubscription
 * with status='TRIALING'.
 *
 * All operations are gated by the billing_enabled feature flag.
 * When billing is OFF, trial endpoints return inactive status.
 */

import type { PrismaClient } from '@prisma/client';
import { SubscriptionStatus } from '@poolmaster/shared/domain/enums';
import { isBillingEnabled } from './billing-feature-gate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrialRecord {
  id: string;
  tenantId: string;
  planSlug: string;
  startDate: Date;
  endDate: Date;
  convertedAt: Date | null;
  paymentMethodId: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'CONVERTED';
}

export interface TrialStatus {
  isActive: boolean;
  planSlug: string | null;
  daysRemaining: number;
  startDate: Date | null;
  endDate: Date | null;
  status: 'ACTIVE' | 'EXPIRED' | 'CONVERTED' | 'NONE';
}

export interface TrialReminder {
  tenantId: string;
  planSlug: string;
  daysRemaining: number;
  endDate: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIAL_DURATION_DAYS = 14;
const REMINDER_THRESHOLDS = [3, 1];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TrialService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Starts a 14-day trial for a tenant on the specified plan.
   * Gated by billing_enabled flag.
   */
  async startTrial(
    tenantId: string,
    planSlug: string,
  ): Promise<TrialRecord> {
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      throw new Error('Billing is not enabled. Trials are unavailable.');
    }

    // Check for existing active trial
    const existing = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });
    if (existing && existing.status === SubscriptionStatus.TRIALING) {
      throw new Error(`Tenant ${tenantId} already has an active trial.`);
    }

    const now = new Date();
    const endDate = addDays(now, TRIAL_DURATION_DAYS);

    const row = await this.prisma.tenantSubscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        stripeCustomerId: '',
        planTierSlug: planSlug,
        billingCycle: 'MONTHLY',
        status: SubscriptionStatus.TRIALING,
        trialStart: now,
        trialEnd: endDate,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
        currency: 'usd',
      },
      update: {
        planTierSlug: planSlug,
        status: SubscriptionStatus.TRIALING,
        trialStart: now,
        trialEnd: endDate,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
      },
    });

    return {
      id: row.id,
      tenantId: row.tenantId,
      planSlug: row.planTierSlug,
      startDate: row.trialStart!,
      endDate: row.trialEnd!,
      convertedAt: null,
      paymentMethodId: null,
      status: 'ACTIVE',
    };
  }

  /**
   * Returns the current trial status for a tenant.
   */
  async checkTrialStatus(tenantId: string): Promise<TrialStatus> {
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return {
        isActive: false,
        planSlug: null,
        daysRemaining: 0,
        startDate: null,
        endDate: null,
        status: 'NONE',
      };
    }

    const row = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });

    if (!row || !row.trialStart) {
      return {
        isActive: false,
        planSlug: null,
        daysRemaining: 0,
        startDate: null,
        endDate: null,
        status: 'NONE',
      };
    }

    const now = new Date();
    let status: 'ACTIVE' | 'EXPIRED' | 'CONVERTED' | 'NONE';

    if (row.status === SubscriptionStatus.TRIALING) {
      if (row.trialEnd && now > row.trialEnd) {
        // Trial expired — update status
        await this.prisma.tenantSubscription.update({
          where: { tenantId },
          data: { status: SubscriptionStatus.PAST_DUE },
        });
        status = 'EXPIRED';
      } else {
        status = 'ACTIVE';
      }
    } else if (row.status === SubscriptionStatus.ACTIVE) {
      status = 'CONVERTED';
    } else {
      status = 'EXPIRED';
    }

    return {
      isActive: status === 'ACTIVE',
      planSlug: row.planTierSlug,
      daysRemaining: status === 'ACTIVE' && row.trialEnd
        ? daysBetween(now, row.trialEnd)
        : 0,
      startDate: row.trialStart,
      endDate: row.trialEnd,
      status,
    };
  }

  /**
   * Converts a trial to a paid subscription by attaching a payment method.
   * Gated by billing_enabled flag.
   */
  async convertTrial(
    tenantId: string,
    paymentMethodId: string,
  ): Promise<TrialRecord> {
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      throw new Error('Billing is not enabled. Trial conversion unavailable.');
    }

    const row = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });
    if (!row) {
      throw new Error(`No trial found for tenant: ${tenantId}`);
    }
    if (row.status !== SubscriptionStatus.TRIALING) {
      throw new Error(`Trial is not active (status: ${row.status})`);
    }

    const now = new Date();
    const updated = await this.prisma.tenantSubscription.update({
      where: { tenantId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        paymentMethodLast4: paymentMethodId.slice(-4),
      },
    });

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      planSlug: updated.planTierSlug,
      startDate: updated.trialStart!,
      endDate: updated.trialEnd!,
      convertedAt: now,
      paymentMethodId,
      status: 'CONVERTED',
    };
  }

  /**
   * Returns tenants whose trial ends within the reminder thresholds (3d or 1d).
   */
  async getTrialReminders(): Promise<TrialReminder[]> {
    const trials = await this.prisma.tenantSubscription.findMany({
      where: { status: SubscriptionStatus.TRIALING },
    });

    const reminders: TrialReminder[] = [];
    const now = new Date();

    for (const trial of trials) {
      if (!trial.trialEnd) {
        continue;
      }
      const daysRemaining = daysBetween(now, trial.trialEnd);
      const shouldRemind = REMINDER_THRESHOLDS.includes(daysRemaining);
      if (shouldRemind) {
        reminders.push({
          tenantId: trial.tenantId,
          planSlug: trial.planTierSlug,
          daysRemaining,
          endDate: trial.trialEnd,
        });
      }
    }

    return reminders;
  }
}
