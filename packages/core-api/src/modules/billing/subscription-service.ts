/**
 * SubscriptionService — manages tenant subscription lifecycle using Prisma
 * TenantSubscription table.
 *
 * Read paths are backed by the database. Provider-dependent write paths are
 * intentionally unavailable until a real billing provider integration exists.
 */

import type { PrismaClient } from '@prisma/client';
import { SubscriptionStatus } from '@poolmaster/shared/domain';
import { isBillingEnabled } from './billing-feature-gate';
import { BillingProviderUnavailableError } from './stripe-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export interface TenantSubscription {
  id: string;
  tenantId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  planSlug: string;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  trialStart: Date | null;
  trialEnd: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelledAt: Date | null;
  cancelAtPeriodEnd: boolean;
  paymentMethodLast4: string | null;
  paymentMethodBrand: string | null;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SubscriptionCreateInput {
  tenantId: string;
  planSlug: string;
  cycle: BillingCycle;
}

function toApiSubscription(row: {
  id: string;
  tenantId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  planTierSlug: string;
  billingCycle: string;
  status: string;
  trialStart: Date | null;
  trialEnd: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  cancelAtPeriodEnd: boolean;
  paymentMethodLast4: string | null;
  paymentMethodBrand: string | null;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}): TenantSubscription {
  const now = new Date();
  return {
    id: row.id,
    tenantId: row.tenantId,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    planSlug: row.planTierSlug,
    billingCycle: row.billingCycle as BillingCycle,
    status: row.status as SubscriptionStatus,
    trialStart: row.trialStart,
    trialEnd: row.trialEnd,
    currentPeriodStart: row.currentPeriodStart ?? now,
    currentPeriodEnd: row.currentPeriodEnd ?? now,
    cancelledAt: row.cancelledAt,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    paymentMethodLast4: row.paymentMethodLast4,
    paymentMethodBrand: row.paymentMethodBrand,
    currency: row.currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function freeTierSubscription(tenantId: string): TenantSubscription {
  const now = new Date();
  return {
    id: 'free',
    tenantId,
    stripeCustomerId: '',
    stripeSubscriptionId: null,
    planSlug: 'free',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    trialStart: null,
    trialEnd: null,
    currentPeriodStart: now,
    currentPeriodEnd: now,
    cancelledAt: null,
    cancelAtPeriodEnd: false,
    paymentMethodLast4: null,
    paymentMethodBrand: null,
    currency: 'usd',
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Provider-backed subscription creation is not available in this repo yet.
   */
  private throwProviderUnavailable(operation: string): never {
    throw new BillingProviderUnavailableError(operation);
  }

  /**
   * Creates a new subscription for a tenant.
   * Gated by billing_enabled flag.
   */
  async createSubscription(
    input: SubscriptionCreateInput,
  ): Promise<TenantSubscription> {
    const billingOn = await isBillingEnabled(input.tenantId);
    if (!billingOn) {
      return freeTierSubscription(input.tenantId);
    }
    void input;
    return this.throwProviderUnavailable('subscription creation');
  }

  /**
   * Changes the plan for an existing subscription.
   * Gated by billing_enabled flag.
   */
  async changePlan(
    tenantId: string,
    newPlanSlug: string,
  ): Promise<TenantSubscription> {
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return freeTierSubscription(tenantId);
    }
    void newPlanSlug;
    return this.throwProviderUnavailable('subscription plan change');
  }

  /**
   * Cancels a subscription. If immediate=false, cancels at period end.
   * Gated by billing_enabled flag.
   */
  async cancelSubscription(
    tenantId: string,
    immediate: boolean,
  ): Promise<TenantSubscription> {
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return freeTierSubscription(tenantId);
    }
    void immediate;
    return this.throwProviderUnavailable('subscription cancellation');
  }

  /**
   * Resumes a subscription that was set to cancel at period end.
   * Gated by billing_enabled flag.
   */
  async resumeSubscription(
    tenantId: string,
  ): Promise<TenantSubscription> {
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return freeTierSubscription(tenantId);
    }
    return this.throwProviderUnavailable('subscription resume');
  }

  /**
   * Returns the current subscription for a tenant.
   * When billing is OFF, returns a free-tier stub.
   */
  async getSubscription(
    tenantId: string,
  ): Promise<TenantSubscription> {
    const billingOn = await isBillingEnabled(tenantId);
    if (!billingOn) {
      return freeTierSubscription(tenantId);
    }
    const row = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });
    if (!row) {
      return freeTierSubscription(tenantId);
    }
    return toApiSubscription(row);
  }
}
