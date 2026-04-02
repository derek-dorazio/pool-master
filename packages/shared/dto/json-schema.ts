/**
 * Utility to convert Zod schemas to JSON Schema for Fastify route validation
 * and OpenAPI spec generation.
 */
import { zodToJsonSchema as convert } from 'zod-to-json-schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToJsonSchema(schema: any): Record<string, unknown> {
  return convert(schema, { target: 'openApi3' }) as Record<string, unknown>;
}
