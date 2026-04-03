/**
 * EnterpriseService — manages custom enterprise plan creation and
 * administration for large tenants (corporate leagues, media companies).
 */

import type { PlanEntitlements } from '@poolmaster/shared/domain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnterprisePlan {
  id: string;
  tenantId: string;
  customName: string;
  basePlan: string;
  customEntitlements: Partial<PlanEntitlements>;
  customMonthlyPriceCents: number;
  billingMethod: 'STRIPE' | 'INVOICE' | 'CONTRACT';
  contractStart: Date;
  contractEnd: Date;
  slaTier: 'STANDARD' | 'PREMIUM';
  whiteLabel: boolean;
  dedicatedSupportContact?: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEnterprisePlanInput {
  tenantId: string;
  customName: string;
  basePlan?: string;
  customEntitlements?: Partial<PlanEntitlements>;
  customMonthlyPriceCents: number;
  billingMethod?: 'STRIPE' | 'INVOICE' | 'CONTRACT';
  contractStart?: Date;
  contractEnd?: Date;
  slaTier?: 'STANDARD' | 'PREMIUM';
  whiteLabel?: boolean;
  dedicatedSupportContact?: string;
  notes?: string;
}

export class EnterprisePlanUnavailableError extends Error {
  constructor(operation: string) {
    super(`Enterprise plan storage is unavailable for ${operation} until a persisted model exists`);
    this.name = 'EnterprisePlanUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EnterpriseService {
  /**
   * Create a new enterprise plan for a tenant.
   */
  async createEnterprisePlan(input: CreateEnterprisePlanInput): Promise<EnterprisePlan> {
    void input;
    throw new EnterprisePlanUnavailableError('enterprise plan creation');
  }

  /**
   * List all enterprise plans.
   */
  async listEnterprisePlans(): Promise<EnterprisePlan[]> {
    throw new EnterprisePlanUnavailableError('enterprise plan listing');
  }

  /**
   * Get enterprise plan for a specific tenant.
   */
  async getEnterprisePlan(tenantId: string): Promise<EnterprisePlan | null> {
    void tenantId;
    return null;
  }

  /**
   * Update an existing enterprise plan.
   */
  async updateEnterprisePlan(
    tenantId: string,
    updates: Partial<EnterprisePlan>,
  ): Promise<EnterprisePlan> {
    void tenantId;
    void updates;
    throw new EnterprisePlanUnavailableError('enterprise plan updates');
  }
}
