/**
 * StripeService — mock Stripe client for building and testing the full
 * subscription flow without real Stripe credentials.
 *
 * Implements the same interface shape as the real Stripe SDK so the
 * switch to production only requires swapping the client constructor.
 */

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'UNPAID'
  | 'CANCELLED'
  | 'INCOMPLETE'
  | 'PAUSED';

export interface MockSubscription {
  id: string;
  customer: string;
  status: SubscriptionStatus;
  items: { price: string }[];
  trial_start?: number;
  trial_end?: number;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  cancelled_at?: number;
  metadata: Record<string, string>;
}

export interface MockInvoice {
  id: string;
  customer: string;
  subscription?: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  period_start: number;
  period_end: number;
  paid_at?: number;
  invoice_pdf?: string;
  created: number;
}

export interface StripeClient {
  customers: {
    create(params: {
      email: string;
      name: string;
      metadata: Record<string, string>;
    }): Promise<{ id: string }>;
  };
  subscriptions: {
    create(params: {
      customer: string;
      items: { price: string }[];
      trial_period_days?: number;
    }): Promise<MockSubscription>;
    update(id: string, params: Record<string, unknown>): Promise<MockSubscription>;
    cancel(id: string, params?: { at_period_end?: boolean }): Promise<MockSubscription>;
  };
  setupIntents: {
    create(params: { customer: string }): Promise<{ client_secret: string }>;
  };
  billingPortal: {
    sessions: {
      create(params: {
        customer: string;
        return_url: string;
      }): Promise<{ url: string }>;
    };
  };
  invoices: {
    list(params: {
      customer: string;
      limit?: number;
    }): Promise<{ data: MockInvoice[] }>;
    retrieveUpcoming(params: { customer: string }): Promise<MockInvoice>;
  };
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const customers: Map<string, { id: string; email: string; name: string; metadata: Record<string, string> }> = new Map();
const subscriptions: Map<string, MockSubscription> = new Map();
const invoices: Map<string, MockInvoice[]> = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function daysFromNow(days: number): number {
  return nowEpoch() + days * 86400;
}

// ---------------------------------------------------------------------------
// MockStripeClient
// ---------------------------------------------------------------------------

export class MockStripeClient implements StripeClient {
  customers = {
    async create(params: {
      email: string;
      name: string;
      metadata: Record<string, string>;
    }): Promise<{ id: string }> {
      const id = `cus_mock_${randomUUID().slice(0, 8)}`;
      customers.set(id, { id, ...params });
      return { id };
    },
  };

  subscriptions = {
    async create(params: {
      customer: string;
      items: { price: string }[];
      trial_period_days?: number;
    }): Promise<MockSubscription> {
      const id = `sub_mock_${randomUUID().slice(0, 8)}`;
      const now = nowEpoch();
      const hasTrialDays = params.trial_period_days && params.trial_period_days > 0;
      const sub: MockSubscription = {
        id,
        customer: params.customer,
        status: hasTrialDays ? 'TRIALING' : 'ACTIVE',
        items: params.items,
        trial_start: hasTrialDays ? now : undefined,
        trial_end: hasTrialDays ? daysFromNow(params.trial_period_days!) : undefined,
        current_period_start: now,
        current_period_end: daysFromNow(30),
        cancel_at_period_end: false,
        metadata: {},
      };
      subscriptions.set(id, sub);
      return sub;
    },
    async update(id: string, params: Record<string, unknown>): Promise<MockSubscription> {
      const sub = subscriptions.get(id);
      if (!sub) {
        throw new Error(`Subscription not found: ${id}`);
      }
      const updated = { ...sub, ...params } as MockSubscription;
      subscriptions.set(id, updated);
      return updated;
    },
    async cancel(id: string, params?: { at_period_end?: boolean }): Promise<MockSubscription> {
      const sub = subscriptions.get(id);
      if (!sub) {
        throw new Error(`Subscription not found: ${id}`);
      }
      if (params?.at_period_end) {
        sub.cancel_at_period_end = true;
      } else {
        sub.status = 'CANCELLED';
        sub.cancelled_at = nowEpoch();
      }
      subscriptions.set(id, sub);
      return sub;
    },
  };

  setupIntents = {
    async create(params: { customer: string }): Promise<{ client_secret: string }> {
      const secret = `seti_mock_${params.customer}_${randomUUID().slice(0, 8)}_secret`;
      return { client_secret: secret };
    },
  };

  billingPortal = {
    sessions: {
      async create(params: {
        customer: string;
        return_url: string;
      }): Promise<{ url: string }> {
        return {
          url: `https://billing.stripe.com/mock/session/${params.customer}?return_url=${encodeURIComponent(params.return_url)}`,
        };
      },
    },
  };

  invoices = {
    async list(params: {
      customer: string;
      limit?: number;
    }): Promise<{ data: MockInvoice[] }> {
      const customerInvoices = invoices.get(params.customer) ?? [];
      const limit = params.limit ?? 10;
      return { data: customerInvoices.slice(0, limit) };
    },
    async retrieveUpcoming(params: { customer: string }): Promise<MockInvoice> {
      return {
        id: `in_mock_upcoming_${randomUUID().slice(0, 8)}`,
        customer: params.customer,
        amount_due: 2900,
        amount_paid: 0,
        currency: 'usd',
        status: 'draft',
        period_start: nowEpoch(),
        period_end: daysFromNow(30),
        created: nowEpoch(),
      };
    },
  };
}

/**
 * Singleton mock Stripe client instance.
 */
export const stripeClient: StripeClient = new MockStripeClient();
