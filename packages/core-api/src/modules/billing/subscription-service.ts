/**
 * SubscriptionService — manages tenant subscription lifecycle using Prisma
 * TenantSubscription table.
 *
 * All operations are gated by the billing_enabled feature flag.
 * When billing is OFF, returns free-tier stub data.
 * Uses MockStripeClient for Stripe operations.
 */

import type { PrismaClient } from '@prisma/client';
import { isBillingEnabled } from './billing-feature-gate';
import { stripeClient, type SubscriptionStatus } from './stripe-service';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function epochToDate(epoch: number): Date {
  return new Date(epoch * 1000);
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
// Price ID mapping (mock)
// ---------------------------------------------------------------------------

const PLAN_PRICE_MAP: Record<string, Record<BillingCycle, string>> = {
  starter: { MONTHLY: 'price_starter_monthly', ANNUAL: 'price_starter_annual' },
  pro: { MONTHLY: 'price_pro_monthly', ANNUAL: 'price_pro_annual' },
  league_plus: { MONTHLY: 'price_league_plus_monthly', ANNUAL: 'price_league_plus_annual' },
};

const PLAN_TRIAL_DAYS: Record<string, number> = {
  starter: 14,
  pro: 14,
  league_plus: 14,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Ensures a Stripe customer exists for the tenant and returns the customer ID.
   * Checks TenantSubscription for an existing stripeCustomerId first.
   */
  private async ensureCustomer(tenantId: string): Promise<string> {
    const existing = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
      select: { stripeCustomerId: true },
    });
    if (existing) {
      return existing.stripeCustomerId;
    }
    const customer = await stripeClient.customers.create({
      email: `tenant-${tenantId.slice(0, 8)}@poolmaster.app`,
      name: `Tenant ${tenantId.slice(0, 8)}`,
      metadata: { tenantId },
    });
    return customer.id;
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
    const priceMap = PLAN_PRICE_MAP[input.planSlug];
    if (!priceMap) {
      throw new Error(`Unknown plan: ${input.planSlug}`);
    }
    const customerId = await this.ensureCustomer(input.tenantId);
    const trialDays = PLAN_TRIAL_DAYS[input.planSlug] ?? 0;
    const stripeSub = await stripeClient.subscriptions.create({
      customer: customerId,
      items: [{ price: priceMap[input.cycle] }],
      trial_period_days: trialDays,
    });

    const row = await this.prisma.tenantSubscription.upsert({
      where: { tenantId: input.tenantId },
      create: {
        tenantId: input.tenantId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSub.id,
        planTierSlug: input.planSlug,
        billingCycle: input.cycle,
        status: stripeSub.status,
        trialStart: stripeSub.trial_start ? epochToDate(stripeSub.trial_start) : null,
        trialEnd: stripeSub.trial_end ? epochToDate(stripeSub.trial_end) : null,
        currentPeriodStart: epochToDate(stripeSub.current_period_start),
        currentPeriodEnd: epochToDate(stripeSub.current_period_end),
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        cancelledAt: stripeSub.cancelled_at ? epochToDate(stripeSub.cancelled_at) : null,
        currency: 'usd',
      },
      update: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSub.id,
        planTierSlug: input.planSlug,
        billingCycle: input.cycle,
        status: stripeSub.status,
        trialStart: stripeSub.trial_start ? epochToDate(stripeSub.trial_start) : null,
        trialEnd: stripeSub.trial_end ? epochToDate(stripeSub.trial_end) : null,
        currentPeriodStart: epochToDate(stripeSub.current_period_start),
        currentPeriodEnd: epochToDate(stripeSub.current_period_end),
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        cancelledAt: stripeSub.cancelled_at ? epochToDate(stripeSub.cancelled_at) : null,
      },
    });

    return toApiSubscription(row);
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
    const existing = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });
    if (!existing || !existing.stripeSubscriptionId) {
      throw new Error(`No active subscription for tenant: ${tenantId}`);
    }
    const priceMap = PLAN_PRICE_MAP[newPlanSlug];
    if (!priceMap) {
      throw new Error(`Unknown plan: ${newPlanSlug}`);
    }
    const stripeSub = await stripeClient.subscriptions.update(
      existing.stripeSubscriptionId,
      { items: [{ price: priceMap[existing.billingCycle as BillingCycle] }] },
    );
    const row = await this.prisma.tenantSubscription.update({
      where: { tenantId },
      data: {
        planTierSlug: newPlanSlug,
        status: stripeSub.status,
      },
    });
    return toApiSubscription(row);
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
    const existing = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });
    if (!existing || !existing.stripeSubscriptionId) {
      throw new Error(`No active subscription for tenant: ${tenantId}`);
    }
    const stripeSub = await stripeClient.subscriptions.cancel(
      existing.stripeSubscriptionId,
      { at_period_end: !immediate },
    );
    const row = await this.prisma.tenantSubscription.update({
      where: { tenantId },
      data: {
        status: stripeSub.status,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        cancelledAt: stripeSub.cancelled_at ? epochToDate(stripeSub.cancelled_at) : null,
      },
    });
    return toApiSubscription(row);
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
    const existing = await this.prisma.tenantSubscription.findUnique({
      where: { tenantId },
    });
    if (!existing || !existing.stripeSubscriptionId) {
      throw new Error(`No active subscription for tenant: ${tenantId}`);
    }
    const stripeSub = await stripeClient.subscriptions.update(
      existing.stripeSubscriptionId,
      { cancel_at_period_end: false },
    );
    const row = await this.prisma.tenantSubscription.update({
      where: { tenantId },
      data: {
        status: stripeSub.status,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
      },
    });
    return toApiSubscription(row);
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
