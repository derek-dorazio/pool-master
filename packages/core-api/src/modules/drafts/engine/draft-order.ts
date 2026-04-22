/**
 * Draft order generation.
 *
 * Determines the initial pick order for a snake draft.
 * The generated order defines which entry picks first in round 1;
 * subsequent rounds reverse per the snake algorithm.
 */

import type { ServiceLogger } from '../../../core/logger';

export type DraftOrderMethod = 'RANDOM' | 'COMMISSIONER' | 'SIGNUP_ORDER';

/**
 * Generate a draft order by shuffling entry IDs randomly.
 * Uses Fisher-Yates shuffle for unbiased randomness.
 */
export function generateRandomOrder(
  entryIds: string[],
  logger?: ServiceLogger,
): string[] {
  const shuffled = [...entryIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  logger?.info(
    { action: 'draftOrder.generateRandomOrder', data: { entryCount: entryIds.length } },
    'Generated randomized draft order',
  );
  return shuffled;
}

/**
 * Use the commissioner-provided order as-is.
 * Validates that all entry IDs are present exactly once.
 */
export function validateCommissionerOrder(
  providedOrder: string[],
  entryIds: string[],
  logger?: ServiceLogger,
): { valid: boolean; reason?: string } {
  if (providedOrder.length !== entryIds.length) {
    logger?.warn(
      { action: 'draftOrder.validateCommissionerOrder.invalidLength', data: { providedCount: providedOrder.length, entryCount: entryIds.length } },
      'Rejected commissioner draft order because the length did not match the entry count',
    );
    return {
      valid: false,
      reason: `Order has ${providedOrder.length} entries but draft has ${entryIds.length}`,
    };
  }

  const entrySet = new Set(entryIds);
  const orderSet = new Set(providedOrder);

  if (orderSet.size !== providedOrder.length) {
    logger?.warn(
      { action: 'draftOrder.validateCommissionerOrder.duplicate', data: { providedCount: providedOrder.length } },
      'Rejected commissioner draft order because it contained duplicate entries',
    );
    return { valid: false, reason: 'Duplicate entries in provided order' };
  }

  for (const id of providedOrder) {
    if (!entrySet.has(id)) {
      logger?.warn(
        { action: 'draftOrder.validateCommissionerOrder.invalidEntry', data: { entryId: id } },
        'Rejected commissioner draft order because it referenced an unknown entry',
      );
      return { valid: false, reason: `Entry ${id} is not a participant in this draft` };
    }
  }

  logger?.info(
    { action: 'draftOrder.validateCommissionerOrder.success', data: { entryCount: entryIds.length } },
    'Validated commissioner draft order',
  );
  return { valid: true };
}

/**
 * Use signup order — entries pick in the order they joined.
 * Input is assumed to already be sorted by join date.
 */
export function generateSignupOrder(
  entryIds: string[],
  logger?: ServiceLogger,
): string[] {
  const order = [...entryIds];
  logger?.info(
    { action: 'draftOrder.generateSignupOrder', data: { entryCount: order.length } },
    'Generated signup-order draft order',
  );
  return order;
}

/**
 * Generate draft order based on the chosen method.
 */
export function generateDraftOrder(
  method: DraftOrderMethod,
  entryIds: string[],
  commissionerOrder?: string[],
  logger?: ServiceLogger,
): string[] {
  switch (method) {
    case 'RANDOM':
      return generateRandomOrder(entryIds, logger);
    case 'COMMISSIONER': {
      if (!commissionerOrder) {
        logger?.error(
          { action: 'draftOrder.generateDraftOrder.missingCommissionerOrder', data: { method, entryCount: entryIds.length } },
          'Cannot generate commissioner draft order without a commissioner-supplied sequence',
        );
        throw new Error('Commissioner order required when method is COMMISSIONER');
      }
      const validation = validateCommissionerOrder(commissionerOrder, entryIds, logger);
      if (!validation.valid) {
        logger?.error(
          { action: 'draftOrder.generateDraftOrder.invalidCommissionerOrder', data: { method, reason: validation.reason } },
          'Cannot generate commissioner draft order because validation failed',
        );
        throw new Error(validation.reason);
      }
      return [...commissionerOrder];
    }
    case 'SIGNUP_ORDER':
      return generateSignupOrder(entryIds, logger);
    default:
      logger?.error(
        { action: 'draftOrder.generateDraftOrder.unknownMethod', data: { method } },
        'Cannot generate draft order for an unknown method',
      );
      throw new Error(`Unknown draft order method: ${method}`);
  }
}
