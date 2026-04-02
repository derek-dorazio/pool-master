/**
 * Utility to convert Zod schemas to JSON Schema for Fastify route validation
 * and OpenAPI spec generation.
 */
import { zodToJsonSchema as convert } from 'zod-to-json-schema';
import type { ZodType } from 'zod';

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return convert(schema, { target: 'openApi3' }) as Record<string, unknown>;
}
