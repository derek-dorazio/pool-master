/**
 * Draft order generation.
 *
 * Determines the initial pick order for a snake draft.
 * The generated order defines which entry picks first in round 1;
 * subsequent rounds reverse per the snake algorithm.
 */

export type DraftOrderMethod = 'RANDOM' | 'COMMISSIONER' | 'SIGNUP_ORDER';

/**
 * Generate a draft order by shuffling entry IDs randomly.
 * Uses Fisher-Yates shuffle for unbiased randomness.
 */
export function generateRandomOrder(entryIds: string[]): string[] {
  const shuffled = [...entryIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Use the commissioner-provided order as-is.
 * Validates that all entry IDs are present exactly once.
 */
export function validateCommissionerOrder(
  providedOrder: string[],
  entryIds: string[],
): { valid: boolean; reason?: string } {
  if (providedOrder.length !== entryIds.length) {
    return {
      valid: false,
      reason: `Order has ${providedOrder.length} entries but draft has ${entryIds.length}`,
    };
  }

  const entrySet = new Set(entryIds);
  const orderSet = new Set(providedOrder);

  if (orderSet.size !== providedOrder.length) {
    return { valid: false, reason: 'Duplicate entries in provided order' };
  }

  for (const id of providedOrder) {
    if (!entrySet.has(id)) {
      return { valid: false, reason: `Entry ${id} is not a participant in this draft` };
    }
  }

  return { valid: true };
}

/**
 * Use signup order — entries pick in the order they joined.
 * Input is assumed to already be sorted by join date.
 */
export function generateSignupOrder(entryIds: string[]): string[] {
  return [...entryIds];
}

/**
 * Generate draft order based on the chosen method.
 */
export function generateDraftOrder(
  method: DraftOrderMethod,
  entryIds: string[],
  commissionerOrder?: string[],
): string[] {
  switch (method) {
    case 'RANDOM':
      return generateRandomOrder(entryIds);
    case 'COMMISSIONER': {
      if (!commissionerOrder) {
        throw new Error('Commissioner order required when method is COMMISSIONER');
      }
      const validation = validateCommissionerOrder(commissionerOrder, entryIds);
      if (!validation.valid) {
        throw new Error(validation.reason);
      }
      return [...commissionerOrder];
    }
    case 'SIGNUP_ORDER':
      return generateSignupOrder(entryIds);
    default:
      throw new Error(`Unknown draft order method: ${method}`);
  }
}
