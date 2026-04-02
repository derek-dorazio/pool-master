/**
 * Common DTO schemas shared across all API endpoints.
 */
import { z } from 'zod';

// --- Primitives ---

export const UuidSchema = z.string().uuid();
export const DateTimeSchema = z.string().datetime();

// --- Error Envelope ---

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
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
