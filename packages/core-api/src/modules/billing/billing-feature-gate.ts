/**
 * Billing feature gate — checks whether billing features are enabled.
 *
 * When billing is OFF (default):
 *   - All entitlement checks pass (free tier, unlimited)
 *   - Billing API endpoints return free-tier data
 *   - No Stripe calls are made
 *
 * When billing is ON:
 *   - Full billing features activate
 *   - Stripe integration is live
 *   - Usage limits enforced per plan
 */

import { PrismaClient } from '@prisma/client';
import { FlagService, FlagNotFoundError } from '../admin/flag-service';

const flagService = new FlagService(new PrismaClient());

/**
 * Resolves whether billing features are enabled globally or for a specific tenant.
 */
export async function isBillingEnabled(tenantId?: string): Promise<boolean> {
  try {
    if (!tenantId) {
      const flag = await flagService.getFlagDetail('billing_enabled');
      return flag?.enabledGlobally ?? false;
    }
    const resolution = await flagService.resolveFlag('billing_enabled', tenantId);
    return resolution.enabled;
  } catch (err) {
    if (err instanceof FlagNotFoundError) {
      return false;
    }
    throw err;
  }
}
