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

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const enterpriseStore: Map<string, EnterprisePlan> = new Map();

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EnterpriseService {
  /**
   * Create a new enterprise plan for a tenant.
   */
  async createEnterprisePlan(input: CreateEnterprisePlanInput): Promise<EnterprisePlan> {
    const now = new Date();
    const defaultContractEnd = new Date(now);
    defaultContractEnd.setFullYear(defaultContractEnd.getFullYear() + 1);
    const plan: EnterprisePlan = {
      id: `ep-${Date.now()}-${input.tenantId}`,
      tenantId: input.tenantId,
      customName: input.customName,
      basePlan: input.basePlan ?? 'league_plus',
      customEntitlements: input.customEntitlements ?? {},
      customMonthlyPriceCents: input.customMonthlyPriceCents,
      billingMethod: input.billingMethod ?? 'INVOICE',
      contractStart: input.contractStart ?? now,
      contractEnd: input.contractEnd ?? defaultContractEnd,
      slaTier: input.slaTier ?? 'STANDARD',
      whiteLabel: input.whiteLabel ?? false,
      dedicatedSupportContact: input.dedicatedSupportContact,
      notes: input.notes ?? '',
      createdAt: now,
      updatedAt: now,
    };
    enterpriseStore.set(input.tenantId, plan);
    return plan;
  }

  /**
   * List all enterprise plans.
   */
  async listEnterprisePlans(): Promise<EnterprisePlan[]> {
    return Array.from(enterpriseStore.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get enterprise plan for a specific tenant.
   */
  async getEnterprisePlan(tenantId: string): Promise<EnterprisePlan | null> {
    return enterpriseStore.get(tenantId) ?? null;
  }

  /**
   * Update an existing enterprise plan.
   */
  async updateEnterprisePlan(
    tenantId: string,
    updates: Partial<EnterprisePlan>,
  ): Promise<EnterprisePlan> {
    const existing = enterpriseStore.get(tenantId);
    if (!existing) {
      throw new Error(`Enterprise plan not found for tenant: ${tenantId}`);
    }
    const updated: EnterprisePlan = {
      ...existing,
      ...updates,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    enterpriseStore.set(tenantId, updated);
    return updated;
  }
}
