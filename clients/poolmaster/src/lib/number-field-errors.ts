import type { z } from 'zod';

/**
 * What a form says when a number field is left blank or set outside its limits (#1145). The
 * limits come from the field's own schema, usually a shared DTO's, so the wording names the
 * same numbers the server checks and the copy stays in the web app.
 */
export interface NumberFieldWording {
  readonly schema: z.ZodNumber;
  /** The allowed range, said in the field's own unit. */
  readonly range: (min: number, max: number) => string;
  /** A blank or non-numeric value. */
  readonly blank: string;
  /** A fraction where the schema wants a whole number; the range wording when left out. */
  readonly whole?: string;
}

function limitsOf(field: string, schema: z.ZodNumber): readonly [number, number] {
  const { minValue, maxValue } = schema;
  // Zod reports a missing limit as an infinity.
  if (minValue === null || maxValue === null || !Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    throw new Error(`The ${field} field's schema sets no range to describe.`);
  }
  return [minValue, maxValue];
}

/**
 * An error map, passed to `zodResolver` as the parse's `error`, that words each named number
 * field's issues. A field is matched by the last name in the issue's path, so one entry covers
 * the field in every row of a list. Issues on other fields, and any check that carries its own
 * message, are left to Zod.
 */
export function numberFieldErrors(fields: Readonly<Record<string, NumberFieldWording>>): z.core.$ZodErrorMap {
  const ranges = new Map(Object.entries(fields).map(([field, wording]) => {
    const [min, max] = limitsOf(field, wording.schema);
    return [field, { ...wording, rangeText: wording.range(min, max) }];
  }));
  return (issue) => {
    const field = [...(issue.path ?? [])].reverse().find((segment) => typeof segment === 'string');
    const wording = typeof field === 'string' ? ranges.get(field) : undefined;
    if (wording === undefined) return undefined;
    if (issue.code === 'invalid_type') {
      return issue.expected === 'int' ? (wording.whole ?? wording.rangeText) : wording.blank;
    }
    if (issue.code === 'too_small' || issue.code === 'too_big') return wording.rangeText;
    return undefined;
  };
}
