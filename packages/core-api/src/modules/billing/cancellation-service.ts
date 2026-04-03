/**
 * CancellationService — handles subscription cancellation flow including
 * preview, retention offers, feedback collection, and cancellation execution.
 */

import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CancellationPreview {
  currentPlan: string;
  effectiveDate: Date;
  featuresLost: string[];
  dataRetentionDays: number;
  canReactivate: boolean;
}

export interface RetentionOffer {
  id: string;
  type: 'DISCOUNT' | 'EXTENSION' | 'DOWNGRADE';
  description: string;
  discountPercent?: number;
  discountDurationMonths?: number;
  suggestedPlan?: string;
  expiresAt: Date;
}

export interface CancellationFeedback {
  id: string;
  tenantId: string;
  reason: string;
  feedback?: string;
  planAtCancellation: string;
  monthsSubscribed: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_RETENTION_DAYS = 90;
const FEATURES_BY_PLAN: Record<string, string[]> = {
  starter: [
    'Up to 3 leagues',
    'Up to 20 members per league',
    'Standard + custom scoring',
  ],
  pro: [
    'Up to 10 leagues',
    'Up to 50 members per league',
    'All sports access',
    'Full analytics',
    'Custom scoring',
    'Logo branding',
    'Intermediate prizes',
  ],
  league_plus: [
    'Unlimited leagues',
    'Up to 100 members per league',
    'Full white-label branding',
    'API access',
    'Dedicated support',
    'All sports access',
    'Full analytics',
  ],
};

export class CancellationFeedbackUnavailableError extends Error {
  constructor(operation: string) {
    super(`Cancellation feedback is unavailable for ${operation} until a persisted feedback model exists`);
    this.name = 'CancellationFeedbackUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CancellationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Preview what happens when a tenant cancels their subscription.
   */
  async previewCancellation(tenantId: string): Promise<CancellationPreview> {
    const currentSlug = await this.getTenantPlanSlug(tenantId);
    const effectiveDate = new Date();
    effectiveDate.setDate(effectiveDate.getDate() + 30);
    const featuresLost = FEATURES_BY_PLAN[currentSlug] ?? [];
    return {
      currentPlan: currentSlug,
      effectiveDate,
      featuresLost,
      dataRetentionDays: DATA_RETENTION_DAYS,
      canReactivate: true,
    };
  }

  /**
   * Generate a retention offer based on tenant history.
   */
  async getRetentionOffer(tenantId: string): Promise<RetentionOffer | null> {
    const currentSlug = await this.getTenantPlanSlug(tenantId);
    if (currentSlug === 'free') {
      return null;
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    if (currentSlug === 'league_plus' || currentSlug === 'pro') {
      return {
        id: `retain-${tenantId}-discount`,
        type: 'DISCOUNT',
        description: 'Stay on your current plan for 50% off for 3 months',
        discountPercent: 50,
        discountDurationMonths: 3,
        expiresAt,
      };
    }
    return {
      id: `retain-${tenantId}-downgrade`,
      type: 'DOWNGRADE',
      description: 'Switch to Starter plan instead of cancelling',
      suggestedPlan: 'starter',
      expiresAt,
    };
  }

  /**
   * Execute cancellation with reason and optional feedback.
   */
  async cancel(
    tenantId: string,
    reason: string,
    feedback?: string,
  ): Promise<void> {
    void tenantId;
    void reason;
    void feedback;
    throw new CancellationFeedbackUnavailableError('cancellation submission');
  }

  /**
   * List cancellation feedback entries (admin use).
   */
  async listFeedback(
    page: number = 1,
  ): Promise<{ items: CancellationFeedback[]; total: number }> {
    void page;
    throw new CancellationFeedbackUnavailableError('feedback listing');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async getTenantPlanSlug(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planTier: true },
    });
    return tenant?.planTier ?? 'free';
  }
}
