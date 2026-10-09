/**
 * Common DTO schemas shared across all API endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';

// --- Primitives ---

export const UuidSchema = z.string().uuid().describe('UUID string.');
export const DateTimeSchema = z.string().datetime().describe('ISO 8601 datetime string.');
export const JsonObjectSchema = z.record(z.unknown()).describe('Arbitrary JSON object payload.');
export const StringRecordSchema = z.record(z.string()).describe('String-keyed record of string values.');
/**
 * An email address a person typed. Stray spaces are trimmed and the address lowercased before it
 * is checked, so " Derek@X.com " is accepted as "derek@x.com" and can't make a near-duplicate
 * account (#500). Use it for every email a request carries.
 */
export const EmailInputSchema = z.string().trim().toLowerCase().email();

// --- Success Envelope ---

export const SuccessResponseSchema = z.object({
  success: z.literal(true).describe('Confirms that the requested operation succeeded.'),
}).describe('Minimal success response envelope.');
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
// The shared acknowledgement for deletes and other actions that return nothing else (#192).
registerSchema('SuccessResponse', SuccessResponseSchema);
