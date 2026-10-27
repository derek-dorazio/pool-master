import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { numberFieldErrors } from './number-field-errors';

const Cap = z.number().int().min(1).max(10);
const Schema = z.object({ rows: z.array(z.object({ cap: Cap, other: z.number().min(5) })) });
const error = numberFieldErrors({
  cap: { schema: Cap, range: (min, max) => `From ${min} to ${max}.`, blank: 'Enter a cap.', whole: 'Whole caps only.' },
});

function messages(rows: unknown[]) {
  return Schema.safeParse({ rows }, { error }).error?.issues.map((issue) => issue.message) ?? [];
}

describe('numberFieldErrors', () => {
  it('words a named field in every row: its range when out of it, its blank message for NaN, its whole message for a fraction', () => {
    expect(messages([{ cap: 0, other: 5 }, { cap: Number.NaN, other: 5 }, { cap: 2.5, other: 5 }]))
      .toEqual(['From 1 to 10.', 'Enter a cap.', 'Whole caps only.']);
  });

  it('leaves a field it does not name to Zod', () => {
    expect(messages([{ cap: 1, other: 0 }])).toEqual(['Too small: expected number to be >=5']);
  });

  it('refuses a field whose schema sets no range, so the wording never names a missing limit', () => {
    expect(() => numberFieldErrors({ open: { schema: z.number(), range: () => '', blank: '' } }))
      .toThrow('The open field\'s schema sets no range to describe.');
  });
});
