/**
 * SubscriptionService — manages tenant subscription lifecycle.
 *
 * All operations are gated by the billing_enabled feature flag.
 * When billing is OFF, returns free-tier stub data.
 * Uses MockStripeClient for Stripe operations.
 */

import { randomUUID } from 'crypto';
import { isBillingEnabled } from './billing-feature-gate';
import { stripeClient, type MockSubscription, type SubscriptionStatus } from './stripe-service';

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
// In-memory subscription store
// ---------------------------------------------------------------------------

const subscriptionStore: Map<string, TenantSubscription> = new Map();
const tenantCustomerMap: Map<string, string> = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function epochToDate(epoch: number): Date {
  return new Date(epoch * 1000);
}

function buildSubscription(
  tenantId: string,
  stripeCustomerId: string,
  stripeSub: MockSubscription,
  planSlug: string,
  cycle: BillingCycle,
): TenantSubscription {
  const now = new Date();
  return {
    id: randomUUID(),
    tenantId,
    stripeCustomerId,
    stripeSubscriptionId: stripeSub.id,
    planSlug,
    billingCycle: cycle,
    status: stripeSub.status,
    trialStart: stripeSub.trial_start ? epochToDate(stripeSub.trial_start) : null,
    trialEnd: stripeSub.trial_end ? epochToDate(stripeSub.trial_end) : null,
    currentPeriodStart: epochToDate(stripeSub.current_period_start),
    currentPeriodEnd: epochToDate(stripeSub.current_period_end),
    cancelledAt: stripeSub.cancelled_at ? epochToDate(stripeSub.cancelled_at) : null,
    cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    paymentMethodLast4: null,
    paymentMethodBrand: null,
    currency: 'usd',
    createdAt: now,
    updatedAt: now,
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
// Service functions
// ---------------------------------------------------------------------------

/**
 * Ensures a Stripe customer exists for the tenant and returns the customer ID.
 */
async function ensureCustomer(tenantId: string): Promise<string> {
  const existing = tenantCustomerMap.get(tenantId);
  if (existing) {
    return existing;
  }
  const customer = await stripeClient.customers.create({
    email: `tenant-${tenantId.slice(0, 8)}@poolmaster.app`,
    name: `Tenant ${tenantId.slice(0, 8)}`,
    metadata: { tenantId },
  });
  tenantCustomerMap.set(tenantId, customer.id);
  return customer.id;
}

/**
 * Creates a new subscription for a tenant.
 * Gated by billing_enabled flag.
 */
export async function createSubscription(
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
  const customerId = await ensureCustomer(input.tenantId);
  const trialDays = PLAN_TRIAL_DAYS[input.planSlug] ?? 0;
  const stripeSub = await stripeClient.subscriptions.create({
    customer: customerId,
    items: [{ price: priceMap[input.cycle] }],
    trial_period_days: trialDays,
  });
  const subscription = buildSubscription(
    input.tenantId,
    customerId,
    stripeSub,
    input.planSlug,
    input.cycle,
  );
  subscriptionStore.set(input.tenantId, subscription);
  return subscription;
}

/**
 * Changes the plan for an existing subscription.
 * Gated by billing_enabled flag.
 */
export async function changePlan(
  tenantId: string,
  newPlanSlug: string,
): Promise<TenantSubscription> {
  const billingOn = await isBillingEnabled(tenantId);
  if (!billingOn) {
    return freeTierSubscription(tenantId);
  }
  const existing = subscriptionStore.get(tenantId);
  if (!existing || !existing.stripeSubscriptionId) {
    throw new Error(`No active subscription for tenant: ${tenantId}`);
  }
  const priceMap = PLAN_PRICE_MAP[newPlanSlug];
  if (!priceMap) {
    throw new Error(`Unknown plan: ${newPlanSlug}`);
  }
  const stripeSub = await stripeClient.subscriptions.update(
    existing.stripeSubscriptionId,
    { items: [{ price: priceMap[existing.billingCycle] }] },
  );
  const updated: TenantSubscription = {
    ...existing,
    planSlug: newPlanSlug,
    status: stripeSub.status,
    updatedAt: new Date(),
  };
  subscriptionStore.set(tenantId, updated);
  return updated;
}

/**
 * Cancels a subscription. If immediate=false, cancels at period end.
 * Gated by billing_enabled flag.
 */
export async function cancelSubscription(
  tenantId: string,
  immediate: boolean,
): Promise<TenantSubscription> {
  const billingOn = await isBillingEnabled(tenantId);
  if (!billingOn) {
    return freeTierSubscription(tenantId);
  }
  const existing = subscriptionStore.get(tenantId);
  if (!existing || !existing.stripeSubscriptionId) {
    throw new Error(`No active subscription for tenant: ${tenantId}`);
  }
  const stripeSub = await stripeClient.subscriptions.cancel(
    existing.stripeSubscriptionId,
    { at_period_end: !immediate },
  );
  const updated: TenantSubscription = {
    ...existing,
    status: stripeSub.status,
    cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    cancelledAt: stripeSub.cancelled_at ? epochToDate(stripeSub.cancelled_at) : null,
    updatedAt: new Date(),
  };
  subscriptionStore.set(tenantId, updated);
  return updated;
}

/**
 * Resumes a subscription that was set to cancel at period end.
 * Gated by billing_enabled flag.
 */
export async function resumeSubscription(
  tenantId: string,
): Promise<TenantSubscription> {
  const billingOn = await isBillingEnabled(tenantId);
  if (!billingOn) {
    return freeTierSubscription(tenantId);
  }
  const existing = subscriptionStore.get(tenantId);
  if (!existing || !existing.stripeSubscriptionId) {
    throw new Error(`No active subscription for tenant: ${tenantId}`);
  }
  const stripeSub = await stripeClient.subscriptions.update(
    existing.stripeSubscriptionId,
    { cancel_at_period_end: false },
  );
  const updated: TenantSubscription = {
    ...existing,
    status: stripeSub.status,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    updatedAt: new Date(),
  };
  subscriptionStore.set(tenantId, updated);
  return updated;
}

/**
 * Returns the current subscription for a tenant.
 * When billing is OFF, returns a free-tier stub.
 */
export async function getSubscription(
  tenantId: string,
): Promise<TenantSubscription> {
  const billingOn = await isBillingEnabled(tenantId);
  if (!billingOn) {
    return freeTierSubscription(tenantId);
  }
  return subscriptionStore.get(tenantId) ?? freeTierSubscription(tenantId);
}
