/**
 * TrialService — manages 14-day trial lifecycle.
 *
 * All operations are gated by the billing_enabled feature flag.
 * When billing is OFF, trial endpoints return inactive status.
 */

import { randomUUID } from 'crypto';
import { isBillingEnabled } from './billing-feature-gate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrialRecord {
  id: string;
  tenantId: string;
  planSlug: string;
  startDate: Date;
  endDate: Date;
  convertedAt: Date | null;
  paymentMethodId: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'CONVERTED';
}

export interface TrialStatus {
  isActive: boolean;
  planSlug: string | null;
  daysRemaining: number;
  startDate: Date | null;
  endDate: Date | null;
  status: 'ACTIVE' | 'EXPIRED' | 'CONVERTED' | 'NONE';
}

export interface TrialReminder {
  tenantId: string;
  planSlug: string;
  daysRemaining: number;
  endDate: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIAL_DURATION_DAYS = 14;
const REMINDER_THRESHOLDS = [3, 1];

// ---------------------------------------------------------------------------
// In-memory trial store
// ---------------------------------------------------------------------------

const trialStore: Map<string, TrialRecord> = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Starts a 14-day trial for a tenant on the specified plan.
 * Gated by billing_enabled flag.
 */
export async function startTrial(
  tenantId: string,
  planSlug: string,
): Promise<TrialRecord> {
  const billingOn = await isBillingEnabled(tenantId);
  if (!billingOn) {
    throw new Error('Billing is not enabled. Trials are unavailable.');
  }
  const existing = trialStore.get(tenantId);
  if (existing && existing.status === 'ACTIVE') {
    throw new Error(`Tenant ${tenantId} already has an active trial.`);
  }
  const now = new Date();
  const trial: TrialRecord = {
    id: randomUUID(),
    tenantId,
    planSlug,
    startDate: now,
    endDate: addDays(now, TRIAL_DURATION_DAYS),
    convertedAt: null,
    paymentMethodId: null,
    status: 'ACTIVE',
  };
  trialStore.set(tenantId, trial);
  return trial;
}

/**
 * Returns the current trial status for a tenant.
 */
export async function checkTrialStatus(tenantId: string): Promise<TrialStatus> {
  const billingOn = await isBillingEnabled(tenantId);
  if (!billingOn) {
    return {
      isActive: false,
      planSlug: null,
      daysRemaining: 0,
      startDate: null,
      endDate: null,
      status: 'NONE',
    };
  }
  const trial = trialStore.get(tenantId);
  if (!trial) {
    return {
      isActive: false,
      planSlug: null,
      daysRemaining: 0,
      startDate: null,
      endDate: null,
      status: 'NONE',
    };
  }
  const now = new Date();
  if (trial.status === 'ACTIVE' && now > trial.endDate) {
    trial.status = 'EXPIRED';
    trialStore.set(tenantId, trial);
  }
  return {
    isActive: trial.status === 'ACTIVE',
    planSlug: trial.planSlug,
    daysRemaining: trial.status === 'ACTIVE' ? daysBetween(now, trial.endDate) : 0,
    startDate: trial.startDate,
    endDate: trial.endDate,
    status: trial.status,
  };
}

/**
 * Converts a trial to a paid subscription by attaching a payment method.
 * Gated by billing_enabled flag.
 */
export async function convertTrial(
  tenantId: string,
  paymentMethodId: string,
): Promise<TrialRecord> {
  const billingOn = await isBillingEnabled(tenantId);
  if (!billingOn) {
    throw new Error('Billing is not enabled. Trial conversion unavailable.');
  }
  const trial = trialStore.get(tenantId);
  if (!trial) {
    throw new Error(`No trial found for tenant: ${tenantId}`);
  }
  if (trial.status !== 'ACTIVE') {
    throw new Error(`Trial is not active (status: ${trial.status})`);
  }
  trial.convertedAt = new Date();
  trial.paymentMethodId = paymentMethodId;
  trial.status = 'CONVERTED';
  trialStore.set(tenantId, trial);
  return trial;
}

/**
 * Returns tenants whose trial ends within the reminder thresholds (3d or 1d).
 */
export async function getTrialReminders(): Promise<TrialReminder[]> {
  const reminders: TrialReminder[] = [];
  const now = new Date();
  for (const trial of trialStore.values()) {
    if (trial.status !== 'ACTIVE') {
      continue;
    }
    const daysRemaining = daysBetween(now, trial.endDate);
    const shouldRemind = REMINDER_THRESHOLDS.includes(daysRemaining);
    if (shouldRemind) {
      reminders.push({
        tenantId: trial.tenantId,
        planSlug: trial.planSlug,
        daysRemaining,
        endDate: trial.endDate,
      });
    }
  }
  return reminders;
}
