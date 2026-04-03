/**
 * Billing provider adapter.
 *
 * The repository does not currently ship a real Stripe SDK or provider-backed
 * billing integration. Keep the contract explicit by surfacing provider
 * unavailability instead of simulating Stripe in production code.
 */

export class BillingProviderUnavailableError extends Error {
  constructor(operation: string) {
    super(`Billing provider is unavailable for ${operation}`);
    this.name = 'BillingProviderUnavailableError';
  }
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
    }): Promise<never>;
    update(id: string, params: Record<string, unknown>): Promise<never>;
    cancel(id: string, params?: { at_period_end?: boolean }): Promise<never>;
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
    }): Promise<never>;
    retrieveUpcoming(params: { customer: string }): Promise<never>;
  };
}

export const stripeClient: StripeClient = {
  customers: {
    async create() {
      throw new BillingProviderUnavailableError('customer creation');
    },
  },
  subscriptions: {
    async create() {
      throw new BillingProviderUnavailableError('subscription creation');
    },
    async update() {
      throw new BillingProviderUnavailableError('subscription update');
    },
    async cancel() {
      throw new BillingProviderUnavailableError('subscription cancellation');
    },
  },
  setupIntents: {
    async create() {
      throw new BillingProviderUnavailableError('payment method setup');
    },
  },
  billingPortal: {
    sessions: {
      async create() {
        throw new BillingProviderUnavailableError('billing portal access');
      },
    },
  },
  invoices: {
    async list() {
      throw new BillingProviderUnavailableError('invoice listing');
    },
    async retrieveUpcoming() {
      throw new BillingProviderUnavailableError('upcoming invoice preview');
    },
  },
};
