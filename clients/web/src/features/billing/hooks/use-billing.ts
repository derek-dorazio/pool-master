import { useQuery } from '@tanstack/react-query';
import { client, typedData } from '@/lib/api-client-generated';

// TODO: migrate to @poolmaster/shared/dto when billing DTOs align with UI shape
// The shared PlanDto uses slug/monthlyPriceCents/entitlements while the UI uses tier/price/features.
// These local types will be replaced once the billing DTO is updated to match the UI contract.

export type PlanTier = 'free' | 'starter' | 'pro' | 'league-plus';
export type InvoiceStatus = 'paid' | 'pending' | 'failed';
export type BillingCycle = 'monthly' | 'annual';

// TODO: migrate to @poolmaster/shared/dto when DTO is created
export interface BillingPlan {
  tier: PlanTier;
  name: string;
  price: number;
  annualPrice: number;
  features: PlanFeatures;
}

// TODO: migrate to @poolmaster/shared/dto when DTO is created
export interface PlanFeatures {
  leagues: number | null;
  contestsPerLeague: number | null;
  membersPerLeague: number | null;
  draftTypes: string;
  scoringTemplates: string;
  supportLevel: string;
  historyRetention: string;
  customScoring: boolean;
}

// TODO: migrate to @poolmaster/shared/dto when DTO is created
export interface UsageStats {
  leagues: { current: number; limit: number | null };
  contests: { current: number; limit: number | null };
  members: { current: number; limit: number | null };
}

// TODO: migrate to @poolmaster/shared/dto when DTO is created
export interface Subscription {
  tier: PlanTier;
  name: string;
  price: number;
  cycle: BillingCycle;
  renewalDate: string | null;
  status: 'active' | 'trialing' | 'cancelled';
}

// TODO: migrate to @poolmaster/shared/dto when DTO is created
export interface Invoice {
  id: string;
  number: string;
  date: string;
  amount: number;
  status: InvoiceStatus;
  planName: string;
}

const billingKeys = {
  all: ['billing'] as const,
  subscription: () => [...billingKeys.all, 'subscription'] as const,
  usage: () => [...billingKeys.all, 'usage'] as const,
  plans: () => [...billingKeys.all, 'plans'] as const,
  invoices: () => [...billingKeys.all, 'invoices'] as const,
  enabled: () => [...billingKeys.all, 'enabled'] as const,
};

export function useBillingEnabled() {
  return useQuery({
    queryKey: billingKeys.enabled(),
    queryFn: async (): Promise<boolean> => {
      const result = await client.GET('/api/v1/billing/plan');
      const plan = await typedData<BillingPlan>(result);
      return !!plan;
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useBillingPlan() {
  return useQuery({
    queryKey: billingKeys.subscription(),
    queryFn: async () => {
      const result = await client.GET('/api/v1/billing/plan');
      return typedData<BillingPlan>(result);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useBillingUsage() {
  return useQuery({
    queryKey: billingKeys.usage(),
    queryFn: async () => {
      const result = await client.GET('/api/v1/billing/usage');
      return typedData<UsageStats>(result);
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useBillingSubscription() {
  return useQuery({
    queryKey: [...billingKeys.subscription(), 'detail'] as const,
    queryFn: async () => {
      const result = await client.GET('/api/v1/billing/plan');
      return typedData<Subscription | null>(result);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function usePlanTiers() {
  return useQuery({
    queryKey: billingKeys.plans(),
    queryFn: async () => {
      const result = await client.GET('/api/v1/billing/plans');
      return typedData<BillingPlan[]>(result);
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: billingKeys.invoices(),
    queryFn: async () => {
      const result = await client.GET('/api/v1/billing/invoices');
      return typedData<Invoice[]>(result);
    },
    staleTime: 5 * 60 * 1000,
  });
}
