/**
 * Common DTO schemas shared across all API endpoints.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.dto';

// --- Primitives ---

export const UuidSchema = z.string().uuid().describe('UUID string.');
export const DateTimeSchema = z.string().datetime().describe('ISO 8601 datetime string.');
export const JsonObjectSchema = z.record(z.unknown()).describe('Arbitrary JSON object payload.');
export const StringRecordSchema = z.record(z.string()).describe('String-keyed record of string values.');

// --- Error Envelope ---
// Compatibility alias for older imports. New code should prefer ErrorEnvelopeSchema directly.
export const ApiErrorSchema = ErrorEnvelopeSchema;
export type ApiError = z.infer<typeof ApiErrorSchema>;

// --- Pagination ---

export function PaginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema).describe('Current result page items.'),
    total: z.number().describe('Total number of matching records.'),
    page: z.number().describe('Current page number.'),
    pageSize: z.number().describe('Number of items requested per page.'),
    totalPages: z.number().describe('Total page count for the current query.'),
  }).describe('Generic paginated response envelope.');
}

// --- Success Envelope ---

export const SuccessSchema = z.object({
  success: z.literal(true).describe('Confirms that the requested operation succeeded.'),
}).describe('Minimal success response envelope.');
export type SuccessResponse = z.infer<typeof SuccessSchema>;
