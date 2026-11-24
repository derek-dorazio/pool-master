import { z } from 'zod';

/**
 * A form's text field holding a whole number inside the range the API sends for it. With no range
 * yet (the provider list still loading) it checks for a whole number only, and the API's 400 says
 * the rest.
 */
export function wholeNumberIn(range: { readonly min: number; readonly max: number } | undefined) {
  if (range === undefined) {
    return z.string().refine((value) => /^\d+$/.test(value), 'Enter a whole number');
  }
  return z.string().refine(
    (value) => /^\d+$/.test(value) && Number(value) >= range.min && Number(value) <= range.max,
    `Enter a whole number from ${String(range.min)} to ${String(range.max)}`,
  );
}
