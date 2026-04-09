/**
 * Common DTO schemas shared across all API endpoints.
 */
import { z } from 'zod';
import { ErrorEnvelopeSchema } from './errors.dto';

// --- Primitives ---

export const UuidSchema = z.string().uuid();
export const DateTimeSchema = z.string().datetime();
export const JsonObjectSchema = z.record(z.unknown());
export const StringRecordSchema = z.record(z.string());

// --- Error Envelope ---
// Compatibility alias for older imports. New code should prefer ErrorEnvelopeSchema directly.
export const ApiErrorSchema = ErrorEnvelopeSchema;
export type ApiError = z.infer<typeof ApiErrorSchema>;

// --- Pagination ---

export function PaginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });
}

// --- Success Envelope ---

export const SuccessSchema = z.object({
  success: z.literal(true),
});
export type SuccessResponse = z.infer<typeof SuccessSchema>;
