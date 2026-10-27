/**
 * Common DTO schemas shared across all API endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';

// --- Primitives ---

export const UuidSchema = z.uuid().describe('UUID string.');
export const DateTimeSchema = z.iso.datetime().describe('ISO 8601 datetime string.');
export const JsonObjectSchema = z.record(z.string(), z.unknown()).describe('Arbitrary JSON object payload.');
export const StringRecordSchema = z.record(z.string(), z.string()).describe('String-keyed record of string values.');
/**
 * An email address a person typed. Stray spaces are trimmed and the address lowercased before it
 * is checked, so " Derek@X.com " is accepted as "derek@x.com" and can't make a near-duplicate
 * account (#500). Use it for every email a request carries.
 */
export const EmailInputSchema = z.string().trim().toLowerCase().check(z.email());
/**
 * A new password a person chooses: 8 to 128 characters. One rule for register, change password
 * and the reset link, so the three cannot drift apart (#847).
 */
export const NewPasswordInputSchema = z.string().min(8).max(128);
/**
 * The time zone and locale a signup form sends, filled from the browser (#1039), so a new
 * member's emails show their own dates from the start. One rule for every way to sign up.
 */
export const SignupTimeZoneInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .optional()
  .describe('IANA time zone the member sees dates and times in, e.g. America/Chicago, filled from the browser. Omitted means US Eastern. A zone the server does not know is refused with 400 TIME_ZONE_UNKNOWN.');
export const SignupLocaleInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(10)
  .optional()
  .describe('BCP 47 locale for formatting the member\'s dates, e.g. en-US, filled from the browser. Omitted means en-US. A malformed one is refused with 400 LOCALE_UNKNOWN.');

// --- Success Envelope ---

export const SuccessResponseSchema = z.object({
  success: z.literal(true).describe('Confirms that the requested operation succeeded.'),
}).describe('Minimal success response envelope.');
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
// The shared acknowledgement for deletes and other actions that return nothing else (#192).
registerSchema('SuccessResponse', SuccessResponseSchema);
