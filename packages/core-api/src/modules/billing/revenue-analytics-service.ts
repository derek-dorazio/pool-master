/**
 * RevenueAnalyticsService — provides SaaS revenue metrics from persisted
 * subscription rows and plan tiers.
 *
 * The repo does not persist historic billing events yet, so history-oriented
 * metrics are derived from current rows instead of fake sample data.
 */

import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RevenueMetrics {
  mrr: number;
  arr: number;
  mrrGrowthRate: number;
  totalSubscribers: number;
  subscribersByPlan: Record<string, number>;
  newSubscribersThisMonth: number;
  churnedSubscribersThisMonth: number;
  churnRate: number;
  netRevenueRetention: number;
  activeTrials: number;
  trialConversionRate: number;
  arpu: number;
  pastDueSubscriptions: number;
  recoveryRate: number;
  revenueAtRisk: number;
}

export interface MetricDataPoint {
  date: string;
  value: number;
}

export interface TrialMetrics {
  activeTrials: number;
  trialConversionRate: number;
  averageTrialToPaidDays: number;
  trialsStartedThisMonth: number;
  trialsConvertedThisMonth: number;
  trialsExpiredThisMonth: number;
  conversionsByPlan: Record<string, number>;
}

export interface ChurnMetrics {
  monthlyChurnRate: number;
  churnedSubscribers: number;
  churnReasons: Record<string, number>;
  churnByPlan: Record<string, number>;
  revenueChurnRate: number;
  revenueChurnedCents: number;
  monthlyHistory: Array<{ month: string; churnRate: number; churned: number }>;
}

type SubscriptionRow = {
  planTierSlug: string;
  status: string;
  billingCycle: string;
  trialStart: Date | null;
  trialEnd: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PlanTierRow = {
  slug: string;
  monthlyPriceCents: number | null;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RevenueAnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  async getMetrics(): Promise<RevenueMetrics> {
    const [subscriptions, planTiers] = await Promise.all([
      this.loadSubscriptions(),
      this.loadPlanTiers(),
    ]);

    const totalSubscribers = subscriptions.length;
    const subscribersByPlan = this.countByPlan(subscriptions, planTiers);
    const activeSubscriptions = subscriptions.filter((row) => row.status === 'ACTIVE');
    const trialSubscriptions = subscriptions.filter((row) => row.status === 'TRIALING');
    const pastDueSubscriptions = subscriptions.filter((row) => row.status === 'PAST_DUE' || row.status === 'UNPAID');
    const cancelledThisMonth = subscriptions.filter((row) => row.cancelledAt && this.isCurrentMonth(row.cancelledAt));
    const createdThisMonth = subscriptions.filter((row) => this.isCurrentMonth(row.createdAt));

    const mrr = this.sumMonthlyRevenue(activeSubscriptions, planTiers);
    const revenueAtRisk = this.sumMonthlyRevenue(pastDueSubscriptions, planTiers);
    const churnRate = totalSubscribers > 0
      ? (cancelledThisMonth.length / totalSubscribers) * 100
      : 0;
    const trialConversionRate = trialSubscriptions.length > 0
      ? (subscriptions.filter((row) => row.status === 'ACTIVE' && row.trialStart).length / trialSubscriptions.length) * 100
      : 0;
    const arpu = activeSubscriptions.length > 0 ? mrr / activeSubscriptions.length : 0;

    return {
      mrr,
      arr: mrr * 12,
      mrrGrowthRate: totalSubscribers > 0
        ? ((createdThisMonth.length - cancelledThisMonth.length) / totalSubscribers) * 100
        : 0,
      totalSubscribers,
      subscribersByPlan,
      newSubscribersThisMonth: createdThisMonth.length,
      churnedSubscribersThisMonth: cancelledThisMonth.length,
      churnRate: Math.round(churnRate * 10) / 10,
      netRevenueRetention: mrr > 0 ? Math.round(((mrr - revenueAtRisk) / mrr) * 1000) / 10 : 0,
      activeTrials: trialSubscriptions.length,
      trialConversionRate: Math.round(trialConversionRate * 10) / 10,
      arpu: Math.round(arpu),
      pastDueSubscriptions: pastDueSubscriptions.length,
      recoveryRate: 0,
      revenueAtRisk,
    };
  }

  async getMetricHistory(metric: string, days: number): Promise<MetricDataPoint[]> {
    const current = await this.getMetrics();
    const lookup: Record<string, number> = {
      mrr: current.mrr,
      arr: current.arr,
      totalSubscribers: current.totalSubscribers,
      churnRate: current.churnRate,
      trialConversionRate: current.trialConversionRate,
      arpu: current.arpu,
    };
    const value = lookup[metric] ?? 0;
    const now = new Date();
    const dataPoints: MetricDataPoint[] = [];
    for (let i = days; i >= 0; i -= 1) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      dataPoints.push({
        date: date.toISOString().split('T')[0],
        value,
      });
    }
    return dataPoints;
  }

  async getSubscribersByPlan(): Promise<Record<string, number>> {
    const [subscriptions, planTiers] = await Promise.all([
      this.loadSubscriptions(),
      this.loadPlanTiers(),
    ]);
    return this.countByPlan(subscriptions, planTiers);
  }

  async getTrialMetrics(): Promise<TrialMetrics> {
    const subscriptions = await this.loadSubscriptions();
    const trialSubscriptions = subscriptions.filter((row) => row.status === 'TRIALING');
    const convertedTrials = subscriptions.filter((row) => row.status === 'ACTIVE' && row.trialStart);
    const expiredTrials = subscriptions.filter((row) => row.status === 'PAST_DUE' && row.trialEnd && this.isCurrentMonth(row.trialEnd));
    const startedThisMonth = subscriptions.filter((row) => row.trialStart && this.isCurrentMonth(row.trialStart));

    const totalTrialDays = convertedTrials.reduce((sum, row) => {
      if (!row.trialStart) {
        return sum;
      }
      return sum + this.diffDays(row.trialStart, row.updatedAt);
    }, 0);

    const conversionsByPlan: Record<string, number> = {};
    for (const row of convertedTrials) {
      conversionsByPlan[row.planTierSlug] = (conversionsByPlan[row.planTierSlug] ?? 0) + 1;
    }

    return {
      activeTrials: trialSubscriptions.length,
      trialConversionRate: subscriptions.filter((row) => row.trialStart).length > 0
        ? Math.round((convertedTrials.length / subscriptions.filter((row) => row.trialStart).length) * 1000) / 10
        : 0,
      averageTrialToPaidDays: convertedTrials.length > 0
        ? Math.round((totalTrialDays / convertedTrials.length) * 10) / 10
        : 0,
      trialsStartedThisMonth: startedThisMonth.length,
      trialsConvertedThisMonth: this.countThisMonth(convertedTrials.map((row) => row.updatedAt)),
      trialsExpiredThisMonth: expiredTrials.length,
      conversionsByPlan,
    };
  }

  async getChurnMetrics(months: number): Promise<ChurnMetrics> {
    const subscriptions = await this.loadSubscriptions();
    const planTiers = await this.loadPlanTiers();
    const cancelled = subscriptions.filter((row) => row.cancelledAt);
    const monthlyHistory: ChurnMetrics['monthlyHistory'] = [];

    for (let i = months - 1; i >= 0; i -= 1) {
      const date = new Date();
      date.setMonth(date.getMonth() - i, 1);
      const monthLabel = date.toISOString().slice(0, 7);
      const churned = cancelled.filter((row) => row.cancelledAt && this.isMonth(row.cancelledAt, date)).length;
      monthlyHistory.push({
        month: monthLabel,
        churnRate: subscriptions.length > 0 ? Math.round((churned / subscriptions.length) * 1000) / 10 : 0,
        churned,
      });
    }

    const churnByPlan: Record<string, number> = {};
    for (const row of cancelled) {
      churnByPlan[row.planTierSlug] = (churnByPlan[row.planTierSlug] ?? 0) + 1;
    }

    const revenueChurnedCents = this.sumMonthlyRevenue(cancelled, planTiers);
    const currentChurned = monthlyHistory[monthlyHistory.length - 1]?.churned ?? 0;

    return {
      monthlyChurnRate: subscriptions.length > 0 ? Math.round((currentChurned / subscriptions.length) * 1000) / 10 : 0,
      churnedSubscribers: cancelled.length,
      churnReasons: {},
      churnByPlan,
      revenueChurnRate: 0,
      revenueChurnedCents,
      monthlyHistory,
    };
  }

  private async loadSubscriptions(): Promise<SubscriptionRow[]> {
    return this.prisma.tenantSubscription.findMany({
      select: {
        planTierSlug: true,
        status: true,
        billingCycle: true,
        trialStart: true,
        trialEnd: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelledAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private async loadPlanTiers(): Promise<PlanTierRow[]> {
    return this.prisma.planTier.findMany({
      select: {
        slug: true,
        monthlyPriceCents: true,
      },
    });
  }

  private countByPlan(subscriptions: SubscriptionRow[], planTiers: PlanTierRow[]): Record<string, number> {
    const counts: Record<string, number> = Object.fromEntries(planTiers.map((tier) => [tier.slug, 0]));
    for (const subscription of subscriptions) {
      counts[subscription.planTierSlug] = (counts[subscription.planTierSlug] ?? 0) + 1;
    }
    return counts;
  }

  private sumMonthlyRevenue(subscriptions: SubscriptionRow[], planTiers: PlanTierRow[]): number {
    const priceByPlan = new Map(planTiers.map((tier) => [tier.slug, tier.monthlyPriceCents ?? 0]));
    return subscriptions.reduce((sum, row) => sum + (priceByPlan.get(row.planTierSlug) ?? 0), 0);
  }

  private isCurrentMonth(date: Date): boolean {
    const now = new Date();
    return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();
  }

  private isMonth(date: Date, monthStart: Date): boolean {
    return date.getUTCFullYear() === monthStart.getUTCFullYear() && date.getUTCMonth() === monthStart.getUTCMonth();
  }

  private diffDays(start: Date, end: Date): number {
    const diffMs = end.getTime() - start.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  private countThisMonth(dates: Date[]): number {
    return dates.filter((date) => this.isCurrentMonth(date)).length;
  }
}
