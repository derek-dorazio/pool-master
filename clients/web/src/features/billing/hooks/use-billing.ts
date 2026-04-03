import { useQuery } from '@tanstack/react-query';
import {
  InvoiceListResponseSchema,
  PlanResponseSchema,
  PlansListResponseSchema,
  SubscriptionResponseSchema,
  UsageResponseSchema,
  type InvoiceDto,
  type PlanDto,
  type SubscriptionDto,
} from '@poolmaster/shared/dto/billing.dto';
import { client, getCurrentPlan, getSubscription, getUsage, listInvoices, listPlans } from '@/lib/api';

export type PlanTier = 'free' | 'starter' | 'pro' | 'league-plus';
export type InvoiceStatus = 'paid' | 'pending' | 'failed';
export type BillingCycle = 'monthly' | 'annual';

export interface BillingPlan {
  tier: PlanTier;
  name: string;
  price: number;
  annualPrice: number;
  features: PlanFeatures;
}

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

export interface UsageStats {
  leagues: { current: number; limit: number | null };
  contests: { current: number; limit: number | null };
  members: { current: number; limit: number | null };
}

export interface Subscription {
  tier: PlanTier;
  name: string;
  cycle: BillingCycle;
  renewalDate: string | null;
  status: 'active' | 'trialing' | 'cancelled';
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  amount: number;
  status: InvoiceStatus;
  planName: string;
}

const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  'league-plus': 'League+',
};

const SUPPORT_TIER_LABELS: Record<string, string> = {
  COMMUNITY: 'Community',
  EMAIL: 'Email',
  EMAIL_CHAT: 'Email + Chat',
  DEDICATED: 'Dedicated',
};

const PLAN_TIER_ALIASES: Record<string, PlanTier> = {
  free: 'free',
  starter: 'starter',
  pro: 'pro',
  league_plus: 'league-plus',
  'league-plus': 'league-plus',
};

function normalizePlanTier(slug: string): PlanTier {
  return PLAN_TIER_ALIASES[slug] ?? 'free';
}

function titleCase(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatAllowedValues(value: unknown): string {
  if (value === 'ALL') return 'All';
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => titleCase(String(item))).join(', ') : 'None';
  }
  if (typeof value === 'string' && value.length > 0) {
    return titleCase(value);
  }
  return 'Standard';
}

function formatHistoryRetention(value: unknown): string {
  if (typeof value === 'number') {
    return value === -1 ? 'Unlimited' : `${value} season${value === 1 ? '' : 's'}`;
  }
  return 'Limited';
}

function mapPlanFeatures(entitlements: Record<string, unknown>): PlanFeatures {
  const leagues = typeof entitlements.max_leagues === 'number'
    ? (entitlements.max_leagues === -1 ? null : entitlements.max_leagues)
    : null;
  const contestsPerLeague = typeof entitlements.max_contests_per_season === 'number'
    ? (entitlements.max_contests_per_season === -1 ? null : entitlements.max_contests_per_season)
    : null;
  const membersPerLeague = typeof entitlements.max_members_per_league === 'number'
    ? (entitlements.max_members_per_league === -1 ? null : entitlements.max_members_per_league)
    : null;

  return {
    leagues,
    contestsPerLeague,
    membersPerLeague,
    draftTypes: formatAllowedValues(entitlements.allowed_draft_types),
    scoringTemplates: entitlements.custom_scoring ? 'Custom' : 'Standard',
    supportLevel: SUPPORT_TIER_LABELS[String(entitlements.support_tier)] ?? 'Community',
    historyRetention: formatHistoryRetention(entitlements.history_seasons),
    customScoring: Boolean(entitlements.custom_scoring),
  };
}

function mapPlanDto(plan: PlanDto): BillingPlan {
  const tier = normalizePlanTier(plan.slug);
  const monthlyPrice = (plan.monthlyPriceCents ?? 0) / 100;
  const annualPrice = (plan.annualPriceCents ?? Math.round((plan.monthlyPriceCents ?? 0) * 12)) / 100;
  return {
    tier,
    name: plan.name || PLAN_TIER_LABELS[tier],
    price: monthlyPrice,
    annualPrice,
    features: mapPlanFeatures(plan.entitlements as Record<string, unknown>),
  };
}

function mapUsageValue(current: number, limit: number): { current: number; limit: number | null } {
  return { current, limit: limit === -1 ? null : limit };
}

function mapInvoiceStatus(invoice: InvoiceDto): InvoiceStatus {
  const normalized = invoice.status.toUpperCase();
  if (normalized === 'PAID') return 'paid';
  if (normalized === 'OPEN' || normalized === 'DRAFT') return 'pending';
  return 'failed';
}

function mapInvoice(invoice: InvoiceDto): Invoice {
  return {
    id: invoice.id,
    number: invoice.stripeInvoiceId ?? invoice.id,
    date: invoice.createdAt
      ? new Date(invoice.createdAt).toLocaleDateString()
      : 'Pending',
    amount: (invoice.amountCents ?? invoice.amount ?? 0) / 100,
    status: mapInvoiceStatus(invoice),
    planName: invoice.lineItems?.[0]?.description ?? 'PoolMaster',
  };
}

function mapSubscriptionStatus(status: string): Subscription['status'] {
  const normalized = status.toUpperCase();
  if (normalized === 'TRIALING') return 'trialing';
  if (normalized === 'CANCELLED') return 'cancelled';
  return 'active';
}

function mapSubscriptionDto(subscription: SubscriptionDto): Subscription | null {
  if (subscription.planSlug === 'free' && !subscription.stripeSubscriptionId) {
    return null;
  }
  const tier = normalizePlanTier(subscription.planSlug);
  return {
    tier,
    name: PLAN_TIER_LABELS[tier],
    cycle: subscription.billingCycle === 'ANNUAL' ? 'annual' : 'monthly',
    renewalDate: subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
      : null,
    status: mapSubscriptionStatus(subscription.status),
  };
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
      const { data, error } = await listPlans({ client });
      if (error) throw error;
      const parsed = PlansListResponseSchema.parse(data);
      return parsed.billingEnabled ?? false;
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useBillingPlan() {
  return useQuery({
    queryKey: billingKeys.subscription(),
    queryFn: async () => {
      const { data, error } = await getCurrentPlan({ client });
      if (error) throw error;
      const parsed = PlanResponseSchema.parse(data);
      return mapPlanDto(parsed);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useBillingUsage() {
  return useQuery({
    queryKey: billingKeys.usage(),
    queryFn: async () => {
      const { data, error } = await getUsage({ client });
      if (error) throw error;
      const parsed = UsageResponseSchema.parse(data);
      return {
        leagues: mapUsageValue(parsed.usage.leagues.current, parsed.usage.leagues.limit),
        contests: mapUsageValue(parsed.usage.contests.current, parsed.usage.contests.limit),
        members: mapUsageValue(parsed.usage.members.current, parsed.usage.members.limit),
      } satisfies UsageStats;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useBillingSubscription() {
  return useQuery({
    queryKey: [...billingKeys.subscription(), 'detail'] as const,
    queryFn: async () => {
      const { data, error } = await getSubscription({ client });
      if (error) throw error;
      const parsed = SubscriptionResponseSchema.parse(data);
      return mapSubscriptionDto(parsed.subscription);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function usePlanTiers() {
  return useQuery({
    queryKey: billingKeys.plans(),
    queryFn: async () => {
      const { data, error } = await listPlans({ client });
      if (error) throw error;
      const parsed = PlansListResponseSchema.parse(data);
      return parsed.plans.map(mapPlanDto);
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: billingKeys.invoices(),
    queryFn: async (): Promise<{ items: Invoice[]; total: number }> => {
      const { data, error } = await listInvoices({ client });
      if (error) throw error;
      const parsed = InvoiceListResponseSchema.parse(data);
      return {
        items: parsed.items.map(mapInvoice),
        total: parsed.total,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
