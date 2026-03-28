/**
 * RevenueAnalyticsService — provides SaaS revenue metrics including
 * MRR, ARR, churn, trial conversion, and subscriber distribution.
 * Returns realistic mock data for a platform with ~200 tenants.
 */

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

// ---------------------------------------------------------------------------
// Mock data constants
// ---------------------------------------------------------------------------

const MOCK_SUBSCRIBERS_BY_PLAN: Record<string, number> = {
  free: 98,
  starter: 52,
  pro: 38,
  league_plus: 14,
};

const MOCK_TOTAL_SUBSCRIBERS = 202;
const MOCK_PAID_SUBSCRIBERS = 104;
const MOCK_MRR = (52 * 900) + (38 * 2900) + (14 * 7900); // 46,800 + 110,200 + 110,600 = 267,600 cents

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RevenueAnalyticsService {
  /**
   * Get all key revenue metrics.
   */
  async getMetrics(): Promise<RevenueMetrics> {
    return {
      mrr: MOCK_MRR,
      arr: MOCK_MRR * 12,
      mrrGrowthRate: 8.3,
      totalSubscribers: MOCK_TOTAL_SUBSCRIBERS,
      subscribersByPlan: { ...MOCK_SUBSCRIBERS_BY_PLAN },
      newSubscribersThisMonth: 18,
      churnedSubscribersThisMonth: 5,
      churnRate: 4.8,
      netRevenueRetention: 112.5,
      activeTrials: 12,
      trialConversionRate: 42.0,
      arpu: Math.round(MOCK_MRR / MOCK_PAID_SUBSCRIBERS),
      pastDueSubscriptions: 6,
      recoveryRate: 72.2,
      revenueAtRisk: 14500,
    };
  }

  /**
   * Get historical data points for a specific metric.
   */
  async getMetricHistory(metric: string, days: number): Promise<MetricDataPoint[]> {
    const dataPoints: MetricDataPoint[] = [];
    const now = new Date();
    const baseValues: Record<string, number> = {
      mrr: MOCK_MRR,
      arr: MOCK_MRR * 12,
      totalSubscribers: MOCK_TOTAL_SUBSCRIBERS,
      churnRate: 4.8,
      trialConversionRate: 42.0,
      arpu: Math.round(MOCK_MRR / MOCK_PAID_SUBSCRIBERS),
    };
    const baseValue = baseValues[metric] ?? 100;
    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      // Simulate growth trend with minor daily variance
      const growthFactor = 1 - (i / days) * 0.15;
      const variance = 1 + (Math.sin(i * 0.7) * 0.03);
      const value = Math.round(baseValue * growthFactor * variance);
      dataPoints.push({
        date: date.toISOString().split('T')[0],
        value,
      });
    }
    return dataPoints;
  }

  /**
   * Get subscriber counts grouped by plan.
   */
  async getSubscribersByPlan(): Promise<Record<string, number>> {
    return { ...MOCK_SUBSCRIBERS_BY_PLAN };
  }

  /**
   * Get trial-specific metrics.
   */
  async getTrialMetrics(): Promise<TrialMetrics> {
    return {
      activeTrials: 12,
      trialConversionRate: 42.0,
      averageTrialToPaidDays: 9.2,
      trialsStartedThisMonth: 22,
      trialsConvertedThisMonth: 8,
      trialsExpiredThisMonth: 6,
      conversionsByPlan: {
        starter: 4,
        pro: 3,
        league_plus: 1,
      },
    };
  }

  /**
   * Get churn metrics over the specified number of months.
   */
  async getChurnMetrics(months: number): Promise<ChurnMetrics> {
    const now = new Date();
    const monthlyHistory: ChurnMetrics['monthlyHistory'] = [];
    for (let i = months - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = date.toISOString().slice(0, 7);
      const churnRate = 3.5 + Math.sin(i * 0.8) * 1.5;
      const churned = Math.round(MOCK_PAID_SUBSCRIBERS * (churnRate / 100));
      monthlyHistory.push({
        month: monthLabel,
        churnRate: Math.round(churnRate * 10) / 10,
        churned,
      });
    }
    return {
      monthlyChurnRate: 4.8,
      churnedSubscribers: 5,
      churnReasons: {
        TOO_EXPENSIVE: 2,
        NOT_ENOUGH_FEATURES: 1,
        SWITCHING_TO_COMPETITOR: 1,
        NO_LONGER_NEEDED: 1,
      },
      churnByPlan: {
        starter: 3,
        pro: 1,
        league_plus: 1,
      },
      revenueChurnRate: 3.2,
      revenueChurnedCents: 8600,
      monthlyHistory,
    };
  }
}
