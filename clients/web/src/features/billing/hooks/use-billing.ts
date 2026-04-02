import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

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

const planTiers: BillingPlan[] = [
  {
    tier: 'free',
    name: 'Free',
    price: 0,
    annualPrice: 0,
    features: {
      leagues: 1,
      contestsPerLeague: 2,
      membersPerLeague: 12,
      draftTypes: 'Snake only',
      scoringTemplates: 'Basic only',
      supportLevel: 'Community',
      historyRetention: 'Current season',
      customScoring: false,
    },
  },
  {
    tier: 'starter',
    name: 'Starter',
    price: 4.99,
    annualPrice: 3.99,
    features: {
      leagues: 3,
      contestsPerLeague: 10,
      membersPerLeague: 25,
      draftTypes: 'Snake, Auction',
      scoringTemplates: 'Standard set',
      supportLevel: 'Email',
      historyRetention: '2 seasons',
      customScoring: false,
    },
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: 9.99,
    annualPrice: 7.99,
    features: {
      leagues: 10,
      contestsPerLeague: 50,
      membersPerLeague: 100,
      draftTypes: 'All types',
      scoringTemplates: 'All templates + custom',
      supportLevel: 'Priority email',
      historyRetention: '5 seasons',
      customScoring: true,
    },
  },
  {
    tier: 'league-plus',
    name: 'League+',
    price: 19.99,
    annualPrice: 15.99,
    features: {
      leagues: null,
      contestsPerLeague: null,
      membersPerLeague: null,
      draftTypes: 'All types',
      scoringTemplates: 'All templates + custom',
      supportLevel: 'Dedicated',
      historyRetention: 'Unlimited',
      customScoring: true,
    },
  },
];

export function useBillingEnabled() {
  return useQuery({
    queryKey: billingKeys.enabled(),
    queryFn: async (): Promise<boolean> => {
      try {
        const plan = await api.get<BillingPlan>('/v1/billing/plan');
        return !!plan;
      } catch {
        // Fallback to disabled when backend unavailable
        return false;
      }
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useBillingPlan() {
  return useQuery({
    queryKey: billingKeys.subscription(),
    queryFn: async (): Promise<BillingPlan> => {
      try {
        return await api.get<BillingPlan>('/v1/billing/plan');
      } catch {
        // Fallback to mock data when backend unavailable
        return planTiers[0];
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}

const mockUsage: UsageStats = {
  leagues: { current: 2, limit: 50 },
  contests: { current: 5, limit: 100 },
  members: { current: 24, limit: 100 },
};

export function useBillingUsage() {
  return useQuery({
    queryKey: billingKeys.usage(),
    queryFn: async (): Promise<UsageStats> => {
      try {
        return await api.get<UsageStats>('/v1/billing/usage');
      } catch {
        // Fallback to mock data when backend unavailable
        return mockUsage;
      }
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useBillingSubscription() {
  return useQuery({
    queryKey: [...billingKeys.subscription(), 'detail'] as const,
    queryFn: async (): Promise<Subscription | null> => {
      try {
        return await api.get<Subscription | null>('/v1/billing/plan');
      } catch {
        // Fallback to mock data when backend unavailable
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function usePlanTiers() {
  return useQuery({
    queryKey: billingKeys.plans(),
    queryFn: async (): Promise<BillingPlan[]> => {
      try {
        return await api.get<BillingPlan[]>('/v1/billing/plans');
      } catch {
        // Fallback to mock data when backend unavailable
        return planTiers;
      }
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: billingKeys.invoices(),
    queryFn: async (): Promise<Invoice[]> => {
      try {
        return await api.get<Invoice[]>('/v1/billing/invoices');
      } catch {
        // Fallback to mock data when backend unavailable
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}
