import type { ZodType, ZodTypeDef } from 'zod';

/**
 * `expectMatchesSchema(Schema, body)` — checks a live response body against its shared DTO
 * schema with `.safeParse()` and returns the parsed body, or fails the test naming every field
 * that does not match (`rules/testing-rules.md` §4 *Contract Verification Rules*).
 *
 * The hey-api SDK the functional suites call does not validate what the server sends back, so a
 * mapper that drops or renames a field passes every journey that does not read that field. A
 * journey that already holds a live response checks its contract here instead of rebuilding the
 * same state in a contract-verification suite:
 *
 *     const bracket = expectMatchesSchema(SportEventBracketResponseSchema, loaded.data);
 *
 * `scripts/check-contract-verification.mjs` counts a call to this helper as the schema's check.
 */
export function expectMatchesSchema<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Expected the response to match its schema, but:\n${issues}`);
  }
  return parsed.data;
}
