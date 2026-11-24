import { z } from 'zod';

/** A form's text field holding a whole number inside a range the API holds it to. */
export function wholeNumberIn(range: { readonly min: number; readonly max: number }) {
  return z.string().refine(
    (value) => /^\d+$/.test(value) && Number(value) >= range.min && Number(value) <= range.max,
    `Enter a whole number from ${String(range.min)} to ${String(range.max)}`,
  );
}
